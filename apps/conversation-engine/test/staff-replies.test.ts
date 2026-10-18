/**
 * mc-5 · the staff-reply queue — brief م-ج §6, on a real database, with a
 * sender of this file's own that returns Meta's id (the recording fake
 * returns none, and is left as it is).
 *
 * The harness of notifier.test.ts: every test builds its restaurant, order
 * and messages through the audit connection above RLS, as the dashboard API
 * writes them, ages them with `now() - interval`, and reads the result back
 * from there. Every queue is confined to its test's restaurants
 * (`restaurantScope`), and every count counts this test's rows alone: the
 * API suite runs alongside under `pnpm -r test` and writes staff messages
 * of its own.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import { parseEnv, staffReplyLongestSendMs } from "../src/config/env.js";
import { TenantDb } from "../src/db/tenant-db.js";
import {
  STAFF_REPLY_RETRY_DELAYS_MS,
  StaffReplySender,
  type StaffReplyLog,
  type StaffReplySenderOptions,
} from "../src/notify/staff-replies.js";
import {
  WhatsAppSendError,
  assertWithinTextLimit,
  type IdentifyingWhatsAppSender,
  type OutboundTextMessage,
  type SentText,
} from "../src/whatsapp/sender.js";

const RUN = randomUUID();

let db: TenantDb;
let audit: Pool;
const createdRestaurants: string[] = [];

let phoneSeq = 0;
const nextPhone = (): string => `96278${String(++phoneSeq).padStart(7, "0")}`;

/**
 * Sends as Meta would — after the same length check — and returns Meta's
 * id; `failures` are thrown first, one per attempt, in order.
 */
class IdSender implements IdentifyingWhatsAppSender {
  readonly sent: OutboundTextMessage[] = [];
  attempts = 0;
  constructor(private readonly failures: Error[] = []) {}
  async sendText(message: OutboundTextMessage): Promise<SentText> {
    this.attempts += 1;
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    assertWithinTextLimit(message.body);
    this.sent.push(message);
    return { waMessageId: `wamid.${RUN}.${this.attempts}` };
  }
}

interface Shop {
  id: string;
  phoneNumberId: string | null;
}

async function shop(
  label: string,
  opts: { phoneNumberId?: string | null } = {},
): Promise<Shop> {
  const phoneNumberId =
    opts.phoneNumberId === undefined
      ? `PHONE.STAFF.${RUN}.${label}`
      : opts.phoneNumberId;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb)
     RETURNING id`,
    [`مطعم رسائل الموظف ${label} ${RUN}`, phoneNumberId],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);
  return { id, phoneNumberId };
}

interface Order {
  id: string;
  customerId: string;
  /** The customer's number. */
  to: string;
}

let orderNumber = 101;

async function order(s: Shop, to = nextPhone()): Promise<Order> {
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2)
     ON CONFLICT (restaurant_id, phone_number) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [s.id, to],
  );
  const customerId = customer.rows[0]?.id ?? "";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, notified,
                         subtotal, total)
     VALUES ($1, $2, $3, 'pickup', 'cash', 'preparing', 'pending_cash', true,
             5.00, 5.00)
     RETURNING id`,
    [s.id, customerId, orderNumber++],
  );
  return { id: rows[0]?.id ?? "", customerId, to };
}

/**
 * A staff message on `o`, written `ageSeconds` ago as the dashboard API
 * writes it (silence 60 minutes). `sending` is claimed `ageSeconds` ago too.
 */
async function staffMessage(
  s: Shop,
  o: Order,
  spec: {
    ageSeconds: number;
    state?: "pending" | "sending" | "sent";
    body?: string;
  },
): Promise<string> {
  const state = spec.state ?? "pending";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_messages (restaurant_id, order_id, client_id, body, send_state,
                                 created_at, silence_until, claimed_at)
     VALUES ($1, $2, $3, $4, $5,
             now() - make_interval(secs => $6),
             now() - make_interval(secs => $6) + interval '60 minutes',
             CASE WHEN $5 <> 'pending' THEN now() - make_interval(secs => $6) END)
     RETURNING id`,
    [
      s.id,
      o.id,
      randomUUID(),
      spec.body ?? "مرحبا، معك المطعم",
      state,
      spec.ageSeconds,
    ],
  );
  return rows[0]?.id ?? "";
}

interface Row {
  send_state: string;
  failure: string | null;
  meta_error_code: number | null;
  wa_message_id: string | null;
  claimed: boolean;
  finished: boolean;
}

async function rowOf(messageId: string): Promise<Row> {
  const { rows } = await audit.query<Row>(
    `SELECT send_state, failure, meta_error_code, wa_message_id,
            claimed_at IS NOT NULL AS claimed, finished_at IS NOT NULL AS finished
       FROM staff_messages WHERE id = $1`,
    [messageId],
  );
  const row = rows[0];
  if (!row) throw new Error(`staff message ${messageId} is not there`);
  return row;
}

interface LogLine {
  level: "error" | "warn" | "info" | "debug";
  obj: Record<string, unknown>;
  msg: string;
}

function captureLog(): { lines: LogLine[]; log: StaffReplyLog } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine["level"]) =>
    (obj: object, msg: string): void => {
      lines.push({ level, obj: obj as Record<string, unknown>, msg });
    };
  return {
    lines,
    log: {
      error: at("error"),
      warn: at("warn"),
      info: at("info"),
      debug: at("debug"),
    },
  };
}

function queue(
  shops: Shop[],
  sender: IdentifyingWhatsAppSender,
  options: StaffReplySenderOptions = {},
): StaffReplySender {
  return new StaffReplySender(db, sender, {
    sleep: async () => undefined,
    log: captureLog().log,
    ...options,
    restaurantScope: shops.map((s) => s.id),
  });
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL is missing — see .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
});

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0) {
    // The cascade takes customers, orders and staff messages along.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

describe("the send — brief م-ج §6", () => {
  it("1. a pending message → one send: to the customer, from the restaurant's number, the text to the letter; sent, Meta's id, finished_at; and no text or number in a log line", async () => {
    const s = await shop("t1");
    const o = await order(s);
    // As staff wrote it: their digits, an emoji, two lines.
    const body = "طلبك بعد ١٠ دقايق 🙏\nشكرا لصبرك";
    const id = await staffMessage(s, o, { ageSeconds: 5, body });
    const sender = new IdSender();
    const { lines, log } = captureLog();

    const result = await queue([s], sender, { log }).tick();

    expect(result.outcomes).toEqual([{ messageId: id, outcome: "sent" }]);
    expect(sender.sent).toEqual([
      { restaurantId: s.id, phoneNumberId: s.phoneNumberId, to: o.to, body },
    ]);
    expect(await rowOf(id)).toEqual({
      send_state: "sent",
      failure: null,
      meta_error_code: null,
      wa_message_id: `wamid.${RUN}.1`,
      claimed: true,
      finished: true,
    });
    const info = lines.filter((l) => l.level === "info");
    expect(info).toHaveLength(1);
    expect(info[0]?.obj).toMatchObject({
      restaurantId: s.id,
      orderId: o.id,
      messageId: id,
      to: `****${o.to.slice(-4)}`,
      outcome: "sent",
    });
    for (const line of lines) {
      expect(JSON.stringify(line)).not.toContain(o.to);
      expect(JSON.stringify(line)).not.toContain("دقايق");
    }
  });

  it("2. 🔴 after the send → no row in outbound_messages: a staff text lives in staff_messages alone", async () => {
    const s = await shop("t2");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });

    await queue([s], new IdSender()).tick();

    expect((await rowOf(id)).send_state).toBe("sent");
    const { rowCount } = await audit.query(
      `SELECT 1 FROM outbound_messages WHERE restaurant_id = $1 AND to_phone = $2`,
      [s.id, o.to],
    );
    expect(rowCount).toBe(0);
  });

  it("3. 🔴 two cycles at the same moment (two processes, both listed it) → one send", async () => {
    const s = await shop("t3");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });
    const sender = new IdSender();

    // Both stop after their listing until both have arrived — so both saw
    // the message `pending` before either claimed it. Ordered, not raced.
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothListed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = async (): Promise<void> => {
      arrived += 1;
      if (arrived === 2) release();
      await bothListed;
    };
    const a = queue([s], sender, { beforeClaim: barrier });
    const b = queue([s], sender, { beforeClaim: barrier });

    const [ra, rb] = await Promise.all([a.tick(), b.tick()]);

    expect(arrived).toBe(2);
    expect(sender.sent).toHaveLength(1);
    expect(
      [...ra.outcomes, ...rb.outcomes].map((x) => x.outcome).sort(),
    ).toEqual(["already_claimed", "sent"]);
    expect((await rowOf(id)).send_state).toBe("sent");
  });

  it("past the table: two cycles in one process → the second skips", async () => {
    const s = await shop("overlap");
    const o = await order(s);
    await staffMessage(s, o, { ageSeconds: 5 });
    const sender = new IdSender();
    const q = queue([s], sender);

    const [first, second] = await Promise.all([q.tick(), q.tick()]);

    expect(first.skipped).toBe(false);
    expect(second).toEqual({ skipped: true, outcomes: [] });
    expect(sender.sent).toHaveLength(1);
  });

  it("4. a passing failure twice, then a send → 3 attempts, after 2 s and 6 s, and sent", async () => {
    const s = await shop("t4");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });
    const sender = new IdSender([
      new WhatsAppSendError("ميتا رفضت الإرسال: 503", 503, null),
      new Error("fetch failed"),
    ]);
    const sleeps: number[] = [];

    await queue([s], sender, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).tick();

    expect(sender.attempts).toBe(3);
    expect(sleeps).toEqual([2000, 6000]);
    expect(await rowOf(id)).toMatchObject({
      send_state: "sent",
      failure: null,
      wa_message_id: `wamid.${RUN}.3`,
    });
  });

  it("5. 🔴 three failures → 3 attempts exactly, failed, send_failed, Meta's code — and never sent again", async () => {
    const s = await shop("t5");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });
    const refused = (): Error =>
      new WhatsAppSendError("ميتا رفضت الإرسال: 400", 400, 131026);
    const sender = new IdSender([refused(), refused(), refused()]);
    const { lines, log } = captureLog();

    const q = queue([s], sender, { log });
    expect((await q.tick()).outcomes).toEqual([
      { messageId: id, outcome: "send_failed" },
    ]);
    await q.tick();

    expect(sender.attempts).toBe(3);
    expect(sender.sent).toEqual([]);
    expect(await rowOf(id)).toMatchObject({
      send_state: "failed",
      failure: "send_failed",
      meta_error_code: 131026,
      wa_message_id: null,
      finished: true,
    });
    const errors = lines.filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toMatchObject({ messageId: id, attempts: 3 });
  });

  it("6. 🔴 Meta's 131047 (the 24 hours) → one attempt, failed, window_closed", async () => {
    const s = await shop("t6");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });
    const sender = new IdSender([
      new WhatsAppSendError("ميتا رفضت الإرسال: 400", 400, 131047),
    ]);
    const sleeps: number[] = [];

    await queue([s], sender, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).tick();

    expect(sender.attempts).toBe(1);
    expect(sleeps).toEqual([]);
    expect(await rowOf(id)).toMatchObject({
      send_state: "failed",
      failure: "window_closed",
      meta_error_code: 131047,
    });
  });

  it("7. a restaurant with no whatsapp_phone_id → no attempt, failed, no_sender_number", async () => {
    const s = await shop("t7", { phoneNumberId: null });
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 5 });
    const sender = new IdSender();

    await queue([s], sender).tick();

    expect(sender.attempts).toBe(0);
    expect(await rowOf(id)).toMatchObject({
      send_state: "failed",
      failure: "no_sender_number",
      meta_error_code: null,
      finished: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Too late is never — decision 9
// ---------------------------------------------------------------------------

describe("too late is never — decision 9", () => {
  it("8. 🔴 pending for 121 s → never sent, failed, expired", async () => {
    const s = await shop("t8");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 121 });
    const sender = new IdSender();
    const { lines, log } = captureLog();

    const result = await queue([s], sender, { log }).tick();

    expect(sender.attempts).toBe(0);
    expect(result.outcomes).toEqual([{ messageId: id, outcome: "expired" }]);
    expect(await rowOf(id)).toMatchObject({
      send_state: "failed",
      failure: "expired",
      claimed: false,
      finished: true,
    });
    expect(
      lines.filter((l) => l.level === "warn" && l.obj["messageId"] === id),
    ).toHaveLength(1);
  });

  it("9. sending, claimed 121 s ago (the process died mid-send) → failed, expired, not sent again", async () => {
    const s = await shop("t9");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 121, state: "sending" });
    const sender = new IdSender();

    await queue([s], sender).tick();

    expect(sender.attempts).toBe(0);
    expect(await rowOf(id)).toMatchObject({
      send_state: "failed",
      failure: "expired",
      finished: true,
    });
  });

  it("10. pending for 119 s → sent", async () => {
    const s = await shop("t10");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 119 });
    const sender = new IdSender();

    await queue([s], sender).tick();

    expect(sender.sent).toHaveLength(1);
    expect((await rowOf(id)).send_state).toBe("sent");
  });

  it("past the table: sending, claimed 30 s ago → left as it is (a send under way)", async () => {
    const s = await shop("sending-young");
    const o = await order(s);
    const id = await staffMessage(s, o, { ageSeconds: 30, state: "sending" });
    const sender = new IdSender();

    await queue([s], sender).tick();

    expect(sender.attempts).toBe(0);
    expect((await rowOf(id)).send_state).toBe("sending");
  });

  it("13. after 8, with a sent message before it → app.bot_silence goes back to the one before (decision 10)", async () => {
    const s = await shop("t13");
    const o = await order(s);
    const earlier = await order(s, o.to);
    await staffMessage(s, earlier, { ageSeconds: 600, state: "sent" });
    await staffMessage(s, o, { ageSeconds: 121 });

    await queue([s], new IdSender()).tick();

    const silence = await db.runInTenant(s.id, async (tx) => {
      const res = await tx.execute<{ silenced_order_id: string }>(
        sql`SELECT silenced_order_id FROM app.bot_silence(${o.customerId}::uuid)`,
      );
      return res.rows;
    });
    expect(silence).toEqual([{ silenced_order_id: earlier.id }]);
  });
});

// ---------------------------------------------------------------------------
// Order and isolation
// ---------------------------------------------------------------------------

describe("order and isolation", () => {
  it("11. three messages to one customer → sent in created_at order", async () => {
    const s = await shop("t11");
    const o = await order(s);
    // Written out of order, so insertion order cannot pass for created_at.
    await staffMessage(s, o, { ageSeconds: 10, body: "تالت" });
    await staffMessage(s, o, { ageSeconds: 30, body: "أول" });
    await staffMessage(s, o, { ageSeconds: 20, body: "تاني" });
    const sender = new IdSender();

    await queue([s], sender).tick();

    expect(sender.sent.map((m) => m.body)).toEqual(["أول", "تاني", "تالت"]);
  });

  it("12. 🔴 two restaurants → each message from its own restaurant's number, none to the other's", async () => {
    const a = await shop("t12-a");
    const b = await shop("t12-b");
    const oa = await order(a);
    const ob = await order(b);
    await staffMessage(a, oa, { ageSeconds: 5, body: "من أ" });
    await staffMessage(b, ob, { ageSeconds: 4, body: "من ب" });
    const sender = new IdSender();

    await queue([a, b], sender).tick();

    expect(sender.sent).toEqual([
      {
        restaurantId: a.id,
        phoneNumberId: a.phoneNumberId,
        to: oa.to,
        body: "من أ",
      },
      {
        restaurantId: b.id,
        phoneNumberId: b.phoneNumberId,
        to: ob.to,
        body: "من ب",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The timer and the startup check
// ---------------------------------------------------------------------------

describe("the timer and the startup check", () => {
  it("14. STAFF_REPLY_POLL_MS=0 → no timer (and the suite's setting is 0)", async () => {
    jest.useFakeTimers();
    try {
      const off = new StaffReplySender(db, new IdSender(), { pollMs: 0 });
      off.start();
      expect(jest.getTimerCount()).toBe(0);

      const on = new StaffReplySender(db, new IdSender(), { pollMs: 5000 });
      on.start();
      expect(jest.getTimerCount()).toBe(1);
      await on.stop();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
    expect(parseEnv(process.env).STAFF_REPLY_POLL_MS).toBe(0);
  });

  it("the queue's cycle is a second by default (brief م-د-9, decision 1)", () => {
    expect(
      parseEnv({ ...process.env, STAFF_REPLY_POLL_MS: undefined })
        .STAFF_REPLY_POLL_MS,
    ).toBe(1000);
  });

  it("15. 🔴 STAFF_REPLY_MAX_WAIT_SECONDS=30 with the default send timeout → the engine refuses to start", () => {
    const withWait = (wait: string, timeout?: string) => (): unknown =>
      parseEnv({
        ...process.env,
        STAFF_REPLY_MAX_WAIT_SECONDS: wait,
        ...(timeout === undefined ? {} : { WHATSAPP_SEND_TIMEOUT_MS: timeout }),
      });

    expect(withWait("30")).toThrow(/STAFF_REPLY_MAX_WAIT_SECONDS/);
    // 3 × 10 000 + 8 000 = 38 000: exactly the longest send is not enough.
    expect(withWait("38")).toThrow(/STAFF_REPLY_MAX_WAIT_SECONDS/);
    expect(withWait("39")).not.toThrow();
    expect(withWait("120")).not.toThrow();
    expect(withWait("120", "40000")).toThrow(/STAFF_REPLY_MAX_WAIT_SECONDS/);
  });

  it("past the table: the startup check's longest send is the queue's own retries", () => {
    const sum = STAFF_REPLY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    for (const timeout of [10_000, 3_000])
      expect(staffReplyLongestSendMs(timeout)).toBe(
        (STAFF_REPLY_RETRY_DELAYS_MS.length + 1) * timeout + sum,
      );
  });
});
