import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  RELAY_CLOSED_STATUSES,
  RELAY_OPEN_STATUSES,
  customers,
  matchCommand,
  orders,
  relayLineAr,
  type OrderStatus,
  type RelayOpenOrder,
  type RelayOpenStatus,
  type RelaySubject,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";

/**
 * A customer's message after an order reaches the restaurant — brief م-أ.
 *
 * The bot's number is on no phone: the bot is the only one who reads it. A
 * customer who ordered and writes «وين طلبي؟» half an hour later used to get
 * the whole menu, and nobody at the restaurant ever saw the question. Now,
 * while they have an order on its way (or one finished a moment ago), the
 * message is linked to that order — the webhook writes `order_id` on its
 * `inbound_messages` row — and the bot answers with one line: where each
 * order stands, that the restaurant has the message, its number, and «منيو»
 * for a new order. That line is not repeated within the quiet minutes.
 *
 * The repo's usual shape: two pure decisions (`decideRelay`,
 * `isRelayReplyDue`) and a thin I/O shell (`relayToRestaurant`), inside the
 * message's transaction, under the restaurant's RLS.
 *
 * 🔴 Where it runs is the decision (decisions 6 and 7): after an active
 *    session's routing — a customer in the middle of a new order carries on
 *    as today — and before the hours gate and the pause, so a customer with
 *    an order on its way gets its status, not the closing or paused text.
 */

/** The relay's three windows, in minutes (`env.ts`; decisions 1 and 4). */
export interface RelayMinutes {
  /** An order on its way counts while younger than this (`created_at`). */
  readonly openOrderMax: number;
  /** A completed or cancelled one, while finished less than this ago. */
  readonly closedOrder: number;
  /** The line is not sent to the same customer again within this. */
  readonly replyQuiet: number;
}

/** An order on its way as the query reads it. */
export interface OpenOrderRow extends RelayOpenOrder {
  readonly id: string;
}

/** A finished order as the query reads it. */
export interface ClosedOrderRow {
  readonly id: string;
  readonly orderNumber: number;
}

export interface RelayDecision {
  /** The order the message is linked to — `inbound_messages.order_id`. */
  readonly orderId: string;
  /** What the line names. */
  readonly subject: RelaySubject;
}

/**
 * The order the message goes to, and what the line names — **pure**
 * (decisions 1 and 2):
 *
 *   - an order on its way beats a finished one;
 *   - with several on their way, the message is linked to the newest, and
 *     the line names them all, oldest first — `open` comes oldest first;
 *   - none on its way: the finished one;
 *   - neither: `null`, the existing path exactly as before.
 */
export function decideRelay(
  open: readonly OpenOrderRow[],
  closed: ClosedOrderRow | null,
): RelayDecision | null {
  const newest = open.at(-1);
  if (newest !== undefined) {
    return {
      orderId: newest.id,
      subject: {
        kind: "open",
        orders: open.map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          fulfillmentType: o.fulfillmentType,
        })),
      },
    };
  }
  if (closed !== null) {
    return {
      orderId: closed.id,
      subject: { kind: "closed", orderNumber: closed.orderNumber },
    };
  }
  return null;
}

/**
 * Whether the line goes out (decision 4): not before `quietMinutes` have
 * passed since the last one went to this customer — however their orders'
 * statuses changed meanwhile. At exactly `quietMinutes`, it goes: `>=`, as
 * `isSessionExpired`.
 *
 * @param sinceLastReplySeconds `now() - customers.relay_replied_at`, on the
 *   database's clock; `null` when the line never went to this customer.
 */
export function isRelayReplyDue(
  sinceLastReplySeconds: number | null,
  quietMinutes: number,
): boolean {
  return (
    sinceLastReplySeconds === null || sinceLastReplySeconds >= quietMinutes * 60
  );
}

export interface RelayInput {
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  /** The customer's number, as Meta sent it. */
  readonly from: string;
  /** The text, or `null` — a voice note, an image, a location… (decision 8). */
  readonly body: string | null;
  /** `restaurants.contact_phone`. NULL: no contact line (`RELAY_CONTACT_AR`). */
  readonly contactPhone: string | null;
  readonly minutes: RelayMinutes;
}

/**
 * The rule — brief م-أ §4 د. `null`: nothing to relay, and the caller
 * carries on down the existing path, unchanged. Otherwise the message is
 * relayed — the order it is linked to is returned, for the webhook to write
 * on the message's row — and the line went out, or the quiet minutes kept it.
 *
 * 🔴 Every time is the database's clock — `now()`, the message
 *    transaction's start — never Node's, like the session timeout (brief ح
 *    §0) and «آخر طلب لك»: `created_at`, `changed_at` and `relay_replied_at`
 *    are all written by the database.
 *
 * 🔴 `relay_replied_at` is read under `FOR UPDATE` on the customer's row,
 *    and written in the same transaction: two messages at the same moment
 *    send one line. The second waits on the lock, then reads the first's
 *    `relay_replied_at`.
 *
 * 🔴 Sent inside the message's transaction, like every conversation reply:
 *    a failed send rolls it back — no `relay_replied_at`, no `order_id` —
 *    and Meta delivers the message again. It names the linked order
 *    (`orderId`), so the saving wrapper keeps it under that order: an order
 *    committed long before this transaction, there for its connection.
 *
 * No session is opened and no customer written: one with an order exists.
 */
export async function relayToRestaurant(
  tx: TenantTx,
  sender: WhatsAppSender,
  input: RelayInput,
): Promise<{ orderId: string } | null> {
  // 1. «منيو» always starts a new order (decision 5): the existing path.
  if (matchCommand(input.body ?? "") === "menu") return null;

  // 2. The customer's orders. By number: RLS confines every table to the
  //    message's restaurant, as in `findReorderSource` — the same number at
  //    another restaurant is another customer.
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.phoneNumber, input.from))
    .limit(1);
  if (customer === undefined) return null;

  const openRows = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        inArray(orders.status, [...RELAY_OPEN_STATUSES]),
        sql`${orders.createdAt} > now() - make_interval(mins => ${input.minutes.openOrderMax})`,
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orders.id));
  // The query reads open statuses alone; the guard tells the type so.
  const open: OpenOrderRow[] = openRows.flatMap((o) =>
    isOpenStatus(o.status) ? [{ ...o, status: o.status }] : [],
  );

  // A finished order counts only when none is on its way (decision 2), so
  // it is read only then.
  const closed =
    open.length > 0
      ? null
      : await findRecentlyClosed(tx, customer.id, input.minutes.closedOrder);

  const decision = decideRelay(open, closed);
  // 3. No order: the existing path.
  if (decision === null) return null;

  // 4. The quiet minutes, under the customer's row lock.
  const [row] = await tx
    .select({
      sinceSeconds: sql<
        number | null
      >`extract(epoch from now() - ${customers.relayRepliedAt})::float8`,
    })
    .from(customers)
    .where(eq(customers.id, customer.id))
    .for("update");
  const due = isRelayReplyDue(
    row?.sinceSeconds ?? null,
    input.minutes.replyQuiet,
  );

  if (due) {
    await sender.sendText({
      restaurantId: input.restaurantId,
      phoneNumberId: input.phoneNumberId,
      to: input.from,
      body: relayLineAr(decision.subject, input.contactPhone),
      orderId: decision.orderId,
    });
    await tx
      .update(customers)
      .set({ relayRepliedAt: sql`now()` })
      .where(eq(customers.id, customer.id));
  }

  // 5. One `info` line: the restaurant, the number masked, the order, and
  //    whether the line went out (logger.ts: never the text).
  logger.info(
    {
      restaurantId: input.restaurantId,
      from: maskPhone(input.from),
      orderId: decision.orderId,
      reply: due ? "sent" : "quiet",
    },
    due
      ? "رسالة الزبون انربطت بطلبه — والسطر انبعت"
      : "رسالة الزبون انربطت بطلبه — بلا رد (دقايق السكوت)",
  );
  return { orderId: decision.orderId };
}

const isOpenStatus = (status: OrderStatus): status is RelayOpenStatus =>
  (RELAY_OPEN_STATUSES as readonly OrderStatus[]).includes(status);

/**
 * The customer's finished order the message would be about: completed or
 * cancelled — `expired` never relays — less than `closedMinutes` ago. Its
 * finishing time is its last history row, or `created_at` for an order with
 * none: `status_changed_at` of `orders.service.ts`. The latest finished, if
 * two are within the window.
 */
async function findRecentlyClosed(
  tx: TenantTx,
  customerId: string,
  closedMinutes: number,
): Promise<ClosedOrderRow | null> {
  const closedAt = sql`COALESCE(
    (SELECT max(h.changed_at) FROM order_status_history h WHERE h.order_id = ${orders.id}),
    ${orders.createdAt})`;
  const [row] = await tx
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        inArray(orders.status, [...RELAY_CLOSED_STATUSES]),
        sql`${closedAt} > now() - make_interval(mins => ${closedMinutes})`,
      ),
    )
    .orderBy(sql`${closedAt} DESC`, sql`${orders.createdAt} DESC`)
    .limit(1);
  return row ?? null;
}
