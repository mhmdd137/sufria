import { sql } from "drizzle-orm";

import { env } from "../config/env.js";
import type { TenantDb } from "../db/tenant-db.js";
import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import {
  WhatsAppSendError,
  type IdentifyingWhatsAppSender,
  type OutboundTextMessage,
} from "../whatsapp/sender.js";

/**
 * The staff-reply queue — brief م-ج §6: the texts staff write to a customer
 * on the dashboard, sent from the bot's number in the same conversation.
 *
 * The dashboard API writes a `staff_messages` row (`pending`) and sends
 * nothing (decision 6). Here, every STAFF_REPLY_POLL_MS, each one is
 * claimed and sent, and moved forward: pending → sending → sent | failed.
 * The shape of `OrderNotifier` (brief و):
 *
 * 🔴 **The claim is atomic, and the text comes from the row it returned.**
 *    `UPDATE … WHERE send_state = 'pending' RETURNING` in one statement: of
 *    two cycles — two processes — that listed the same message, the second
 *    finds zero rows. A read before it would let both send.
 *
 * 🔴 **At most once** (decision 8): the claim commits before the send. A
 *    process that dies in between leaves the row `sending`, and it is failed
 *    as `expired` STAFF_REPLY_MAX_WAIT_SECONDS after its claim — never sent
 *    again: a message twice is worse than one lost, and staff send it again
 *    by hand. A failed send is retried twice (2 s, 6 s) and then `failed`;
 *    Meta's refusal outside the 24 hours (131047) is not retried at all.
 *
 * 🔴 **Too late is never** (decision 9): a message still `pending`
 *    STAFF_REPLY_MAX_WAIT_SECONDS after staff pressed «send» is failed as
 *    `expired` and never sent — «your order in 10 minutes» forty minutes
 *    late must not go out. The claim itself refuses one that old, so the
 *    two never disagree.
 *
 * 🔴 **The raw sender** (`IdentifyingWhatsAppSender` — `MetaWhatsAppSender`
 *    in `main.ts`), never the saving wrapper: a staff text lives in
 *    `staff_messages` alone, with Meta's id, so the conversation shows it
 *    once. The text goes as staff wrote it, with nothing of ours (decision 5).
 *
 * Access: no inbound message, so no tenant context, and `sufria_engine`
 * sees zero rows without one. `app.restaurants_with_pending_staff_messages()`
 * (0018, Bypass #5) returns restaurant ids and nothing else; every read and
 * write after it is inside `runInTenant`.
 */

/** Messages per cycle, oldest first. */
export const STAFF_REPLY_BATCH_SIZE = 50;

/**
 * The two retries after a failed send (decision 8). The startup check's
 * longest send (`staffReplyLongestSendMs`, `config/env.ts`) counts on them.
 */
export const STAFF_REPLY_RETRY_DELAYS_MS: readonly number[] = [2000, 6000];

/** Meta's error for a free-form message outside the 24 hours. */
export const META_OUTSIDE_WINDOW = 131047;

export type StaffReplyOutcome =
  | "sent"
  | "send_failed"
  | "window_closed"
  | "no_sender_number"
  /** Waited too long, or died mid-send (decision 9). Never sent. */
  | "expired"
  /** Zero rows from the claim: someone claimed it first. Skipped. */
  | "already_claimed"
  | "error";

export interface StaffReplyTickResult {
  /** `true` = a cycle was still running in this process: this one skipped. */
  skipped: boolean;
  outcomes: { messageId: string; outcome: StaffReplyOutcome }[];
}

/** What the queue uses from pino. Injected so a test can read the lines. */
export interface StaffReplyLog {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface StaffReplySenderOptions {
  /** `0` (the default) = no timer. `main.ts` passes STAFF_REPLY_POLL_MS. */
  pollMs?: number;
  /** STAFF_REPLY_MAX_WAIT_SECONDS by default. */
  maxWaitSeconds?: number;
  batchSize?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  log?: StaffReplyLog;
  /**
   * 🔴 **Tests alone.** Confines the cycle to these restaurants: the API
   *    suite runs alongside under `pnpm -r test` and writes staff messages
   *    of its own, which an unconfined cycle would claim.
   */
  restaurantScope?: readonly string[];
  /**
   * 🔴 **Tests alone.** Called between the listing and the claim, outside
   *    any transaction — the one place two cycles race.
   */
  beforeClaim?: (messageId: string) => Promise<void>;
}

/** A message as the claim returned it — the send's only source. */
export interface ClaimedStaffMessage {
  id: string;
  orderId: string;
  restaurantId: string;
  /** Staff's text, as they wrote it. **Never** in a log line. */
  body: string;
  /** `customers.phone_number`. **Masked** in every log line. */
  customerPhone: string;
  /** `restaurants.whatsapp_phone_id` — the sender. */
  phoneNumberId: string | null;
}

type SendResult =
  | { kind: "sent"; waMessageId: string | null }
  | { kind: "window_closed"; metaCode: number }
  | { kind: "send_failed"; metaCode: number | null };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class StaffReplySender {
  private readonly pollMs: number;
  private readonly maxWaitSeconds: number;
  private readonly batchSize: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: StaffReplyLog;
  private readonly scope: ReadonlySet<string> | null;
  private readonly beforeClaim: ((messageId: string) => Promise<void>) | null;

  private timer: NodeJS.Timeout | null = null;
  /** The running cycle: the next one skips, and `stop()` waits for it. */
  private current: Promise<StaffReplyTickResult> | null = null;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: IdentifyingWhatsAppSender,
    options: StaffReplySenderOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 0;
    this.maxWaitSeconds =
      options.maxWaitSeconds ?? env().STAFF_REPLY_MAX_WAIT_SECONDS;
    this.batchSize = options.batchSize ?? STAFF_REPLY_BATCH_SIZE;
    this.retryDelaysMs = options.retryDelaysMs ?? STAFF_REPLY_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log ?? logger;
    this.scope = options.restaurantScope
      ? new Set(options.restaurantScope)
      : null;
    this.beforeClaim = options.beforeClaim ?? null;
  }

  /** Starts the timer. `pollMs = 0` → nothing. */
  start(): void {
    if (this.pollMs === 0 || this.timer !== null) return;
    this.timer = setInterval(() => {
      // tick() catches each message on its own; this is for what is above.
      this.tick().catch((error: unknown) => {
        this.log.error({ err: error }, "🔴 staff-reply cycle failed");
      });
    }, this.pollMs);
  }

  /** Stops the timer and waits for the running cycle, so the pool is not closed under it. */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.current !== null) await this.current.catch(() => undefined);
  }

  /**
   * One cycle. **Never two at once in one process**: while one runs, this
   * returns `skipped` at once. Between processes, the guard is the claim's
   * `AND send_state = 'pending'`.
   */
  async tick(): Promise<StaffReplyTickResult> {
    if (this.current !== null) return { skipped: true, outcomes: [] };
    this.current = this.runCycle().then((outcomes) => ({
      skipped: false,
      outcomes,
    }));
    try {
      return await this.current;
    } finally {
      this.current = null;
    }
  }

  private async runCycle(): Promise<StaffReplyTickResult["outcomes"]> {
    const restaurantIds = await this.db.runUnscoped(async (tx) => {
      const res = await tx.execute<{ id: string }>(
        sql`SELECT r AS id FROM app.restaurants_with_pending_staff_messages() r`,
      );
      return res.rows.map((row) => row.id);
    });

    const outcomes: StaffReplyTickResult["outcomes"] = [];
    // The listing: ids and times alone. **No text** — the send is built
    // from the claim's row only, so no first read can be built on.
    const candidates: { id: string; restaurantId: string; at: number }[] = [];
    for (const restaurantId of restaurantIds) {
      if (this.scope !== null && !this.scope.has(restaurantId)) continue;
      try {
        const { expired, pending } = await this.db.runInTenant(
          restaurantId,
          async (tx) => ({
            expired: await expireStale(tx, this.maxWaitSeconds),
            pending: (
              await tx.execute<{ id: string; at: number }>(sql`
                SELECT id, extract(epoch from created_at)::float8 AS at
                  FROM staff_messages
                 WHERE send_state = 'pending'
                 ORDER BY created_at, id
                 LIMIT ${this.batchSize}`)
            ).rows,
          }),
        );
        for (const e of expired) {
          this.log.warn(
            {
              restaurantId,
              orderId: e.order_id,
              messageId: e.id,
              was: e.was_sending ? "sending" : "pending",
            },
            "staff message waited too long — failed as expired, never sent",
          );
          outcomes.push({ messageId: e.id, outcome: "expired" });
        }
        for (const row of pending)
          candidates.push({ id: row.id, restaurantId, at: Number(row.at) });
      } catch (error) {
        // One restaurant does not stop the others.
        this.log.error(
          { err: error, restaurantId },
          "🔴 reading a restaurant's staff messages failed",
        );
      }
    }

    candidates.sort(
      (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    for (const candidate of candidates.slice(0, this.batchSize)) {
      let outcome: StaffReplyOutcome;
      try {
        outcome = await this.sendOne(candidate.id, candidate.restaurantId);
      } catch (error) {
        // 🔴 One message does not stop the cycle.
        this.log.error(
          {
            err: error,
            messageId: candidate.id,
            restaurantId: candidate.restaurantId,
          },
          "🔴 a staff message failed in the queue",
        );
        outcome = "error";
      }
      outcomes.push({ messageId: candidate.id, outcome });
    }
    return outcomes;
  }

  private async sendOne(
    messageId: string,
    restaurantId: string,
  ): Promise<StaffReplyOutcome> {
    if (this.beforeClaim !== null) await this.beforeClaim(messageId);

    const message = await this.db.runInTenant(restaurantId, (tx) =>
      claimStaffMessage(tx, messageId, this.maxWaitSeconds),
    );
    if (message === null) return "already_claimed";

    const fields = {
      restaurantId,
      orderId: message.orderId,
      messageId: message.id,
      to: maskPhone(message.customerPhone),
    };

    let outcome: StaffReplyOutcome;
    if (!message.phoneNumberId) {
      await this.finish(message, fields, {
        failure: "no_sender_number",
        metaCode: null,
      });
      outcome = "no_sender_number";
    } else {
      const result = await this.sendWithRetry(
        {
          restaurantId,
          phoneNumberId: message.phoneNumberId,
          to: message.customerPhone,
          body: message.body,
        },
        fields,
      );
      if (result.kind === "sent") {
        await this.finish(message, fields, {
          waMessageId: result.waMessageId,
        });
      } else {
        await this.finish(message, fields, {
          failure: result.kind,
          metaCode: result.metaCode,
        });
      }
      outcome = result.kind;
    }

    // logger.ts: never the text, and the number masked.
    this.log.info({ ...fields, outcome }, "staff message done");
    return outcome;
  }

  private async sendWithRetry(
    message: OutboundTextMessage,
    fields: object,
  ): Promise<SendResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const sent = await this.sender.sendText(message);
        return { kind: "sent", waMessageId: sent.waMessageId };
      } catch (error) {
        const metaCode =
          error instanceof WhatsAppSendError ? error.metaCode : null;
        const meta = {
          httpStatus: error instanceof WhatsAppSendError ? error.status : null,
          metaCode,
        };
        // 🔴 Outside the 24 hours a retry cannot help (decision 8).
        if (metaCode === META_OUTSIDE_WINDOW) {
          this.log.warn(
            { ...fields, ...meta, attempts: attempt },
            "Meta refused the staff message: outside the 24 hours — no retry",
          );
          return { kind: "window_closed", metaCode };
        }
        const delay = this.retryDelaysMs[attempt - 1];
        if (delay === undefined) {
          // 🔴 Given up: `failed`, at most once — staff send it again by hand.
          this.log.error(
            { ...fields, ...meta, attempts: attempt, err: error },
            "🔴 staff message not sent after every attempt — failed",
          );
          return { kind: "send_failed", metaCode };
        }
        this.log.warn(
          { ...fields, ...meta, attempt, retryInMs: delay },
          "staff message send failed — retrying",
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * The final write, from `sending` alone. Zero rows should never be:
   * nothing else moves a `sending` row but the expiry, which waits longer
   * than the longest send (the startup check).
   */
  private async finish(
    message: ClaimedStaffMessage,
    fields: object,
    end:
      | { waMessageId: string | null }
      | {
          failure: "send_failed" | "window_closed" | "no_sender_number";
          metaCode: number | null;
        },
  ): Promise<void> {
    const sent = "waMessageId" in end;
    const res = await this.db.runInTenant(message.restaurantId, (tx) =>
      tx.execute<{ id: string }>(sql`
        UPDATE staff_messages
           SET send_state = ${sent ? "sent" : "failed"},
               failure = ${sent ? null : end.failure},
               meta_error_code = ${sent ? null : end.metaCode},
               wa_message_id = ${sent ? end.waMessageId : null},
               finished_at = now()
         WHERE id = ${message.id}::uuid
           AND send_state = 'sending'
        RETURNING id`),
    );
    if (res.rows.length === 0)
      this.log.error(
        fields,
        "🔴 a staff message's final state found it no longer sending",
      );
  }
}

/**
 * Decision 9: `pending` older than `maxWaitSeconds` from `created_at`, or
 * `sending` older than it from `claimed_at` (the process died mid-send) →
 * `failed`, `expired`. In the restaurant's context (RLS). Each re-checked
 * against the row as it is once its lock is free: a row claimed meanwhile
 * is `sending`, with a fresh `claimed_at`, and is left alone.
 */
async function expireStale(
  tx: TenantTx,
  maxWaitSeconds: number,
): Promise<{ id: string; order_id: string; was_sending: boolean }[]> {
  const res = await tx.execute<{
    id: string;
    order_id: string;
    was_sending: boolean;
  }>(sql`
    UPDATE staff_messages
       SET send_state = 'failed', failure = 'expired', finished_at = now()
     WHERE (send_state = 'pending'
            AND created_at < now() - make_interval(secs => ${maxWaitSeconds}))
        OR (send_state = 'sending'
            AND claimed_at < now() - make_interval(secs => ${maxWaitSeconds}))
    RETURNING id, order_id, claimed_at IS NOT NULL AS was_sending`);
  return res.rows;
}

/**
 * 🔴 The claim: the state's move and the read in one statement — brief م-ج
 * §6, tried on Postgres as the engine's role.
 *
 * - `AND s.send_state = 'pending'` is the guard between two cycles: the
 *   second finds zero rows. Without it both send.
 * - `AND s.created_at >= now() - …`: one that waited too long is never
 *   claimed, whatever the expiry before it saw (decision 9).
 * - The send is built from `RETURNING` alone: the text as it is in the row.
 *
 * Inside `runInTenant`, so RLS confines it to the context's restaurant.
 */
export async function claimStaffMessage(
  tx: TenantTx,
  messageId: string,
  maxWaitSeconds: number,
): Promise<ClaimedStaffMessage | null> {
  const res = await tx.execute<{
    id: string;
    order_id: string;
    restaurant_id: string;
    body: string;
    phone_number: string;
    whatsapp_phone_id: string | null;
  }>(sql`
    UPDATE staff_messages s
       SET send_state = 'sending', claimed_at = now()
      FROM orders o, customers c, restaurants r
     WHERE s.id = ${messageId}::uuid
       AND s.send_state = 'pending'
       AND s.created_at >= now() - make_interval(secs => ${maxWaitSeconds})
       AND o.id = s.order_id AND c.id = o.customer_id AND r.id = s.restaurant_id
    RETURNING s.id, s.order_id, s.restaurant_id, s.body, c.phone_number,
              r.whatsapp_phone_id`);
  const row = res.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    restaurantId: row.restaurant_id,
    body: row.body,
    customerPhone: row.phone_number,
    phoneNumberId: row.whatsapp_phone_id,
  };
}
