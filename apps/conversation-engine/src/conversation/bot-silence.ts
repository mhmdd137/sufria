import { eq, sql } from "drizzle-orm";
import { customers, matchCommand } from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";

/**
 * The bot keeps quiet for a customer a staff member is talking to — brief
 * م-ج §5.
 *
 * From the moment staff press «send» on the dashboard, the customer's next
 * messages are for them: the bot sends nothing, and each message is linked
 * to the staff message's order (`ctx.relayed.orderId`, the slot of brief
 * م-أ), so the card shows it and rings — by brief م-ب's code, unchanged.
 *
 * 🔴 The rule is not here. It is `app.bot_silence()` (0018), in one place
 *    for the engine and the dashboard alike, and every time in it is the
 *    database's: the latest staff message that did not fail, its
 *    `silence_until`, `customers.bot_resumed_at`, the order's history. No
 *    TypeScript copy of it, so the two can never disagree.
 *
 * 🔴 Where it runs is the decision (decision 3): right after a reaction is
 *    stored, before the restaurant is even read — so before an active
 *    session's routing, the session timeout, the pause, the hours gate and
 *    brief م-أ's relay. A customer in the middle of a cart whom staff wrote
 *    to: their reply goes to staff, and the cart waits, untouched.
 *
 * «منيو» is the customer handing the bot back (decision 1): it ends the
 * silence (`bot_resumed_at = now()`) and carries on down today's path — an
 * active session takes it, or a new order begins.
 */

export interface SilenceInput {
  readonly restaurantId: string;
  /** The customer's number, as Meta sent it. */
  readonly from: string;
  /** The text, or `null` — a voice note, an image, a location… */
  readonly body: string | null;
}

/**
 * `null`: the bot is not quiet for this customer — or was, until this
 * «منيو» — and the caller carries on exactly as before. Otherwise the bot
 * stays quiet, and the order the message is linked to is returned.
 *
 * Inside the message's transaction, under the restaurant's RLS: the same
 * number at another restaurant is another customer, and gives no row.
 */
export async function silenceForStaff(
  tx: TenantTx,
  input: SilenceInput,
): Promise<{ orderId: string } | null> {
  // By number, as `relayToRestaurant` reads them: no customer, no order,
  // no staff message.
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.phoneNumber, input.from))
    .limit(1);
  if (customer === undefined) return null;

  const res = await tx.execute<{ order_id: string }>(
    sql`SELECT silenced_order_id AS order_id
          FROM app.bot_silence(${customer.id}::uuid)`,
  );
  const silence = res.rows[0];
  if (silence === undefined) return null;

  const fields = {
    restaurantId: input.restaurantId,
    from: maskPhone(input.from),
    orderId: silence.order_id,
  };

  if (matchCommand(input.body ?? "") === "menu") {
    await tx
      .update(customers)
      .set({ botResumedAt: sql`now()` })
      .where(eq(customers.id, customer.id));
    logger.info(
      fields,
      "«menu» while staff talk to the customer — the bot is back",
    );
    return null;
  }

  // logger.ts: never the text.
  logger.info(fields, "staff talk to the customer — the bot keeps quiet");
  return { orderId: silence.order_id };
}
