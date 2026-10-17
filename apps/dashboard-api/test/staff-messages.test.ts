/**
 * mc-3 — a staff member writes to the order's customer (brief م-ج §4, tests
 * 1–15): `POST /orders/:id/messages`, `POST /orders/:id/resume-bot`, the staff
 * messages in `GET /orders/:id/messages` with `botSilence` and
 * `replyOpenUntil`, and `staffMessagedAt` on `GET /orders`.
 *
 * The harness of customer-messages.test.ts: the real AppModule over real
 * HTTP, as `sufria_dashboard` with RLS live; fixtures written — and audited —
 * through MIGRATION_DATABASE_URL. Every time is the database's: a customer
 * message is aged with `now() - interval`, and the 24 hours and the silence
 * are measured by the database's clock. Each test has a customer and an
 * order of its own, so the 24 hours of one never open or close another's.
 *
 * 🔴 Two tests are only worth something because of how they are built:
 *
 *   - "two presses at the same moment" runs two instances of the API (with
 *     PG_POOL_MAX=1, two requests to one instance run one after the other),
 *     and stops both at their INSERT behind a SHARE lock on staff_messages —
 *     so both have looked for the `clientId` and found nothing before either
 *     writes. pg_blocking_pids proves both waited there.
 *   - "Node's clock a month off" fakes `Date` in this process, which is the
 *     API's: `silence_until` written from Node would be a month off, and the
 *     row's own CHECK refuses a silence that ends before it begins.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type {
  CreateStaffMessageResponse,
  OrderListItem,
  OrderListResponse,
  OrderMessagesResponse,
  StaffOrderMessage,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `mc3-${process.pid}-${Date.now()}`;
const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };
/** Well-formed, and no order anywhere. */
const NO_SUCH_ORDER = "f0000000-0000-4000-8000-0000000000fc";
const STAFF_NAME = "موظف mc3";

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let restaurantA = "";
let restaurantB = "";
let staffA = "";
let customers = 0;
let nextNumber = 601;
let wamid = 0;

async function startApi(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const instance = moduleRef.createNestApplication();
  await instance.init();
  await instance.listen(0);
  const url = (await instance.getUrl()).replace("[::1]", "127.0.0.1");
  return { app: instance, url };
}

async function createRestaurant(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${label} ${RUN}`, `PHONE_${label}_${RUN}`],
  );
  const id = rows[0]!.id;
  createdRestaurants.push(id);
  return id;
}

interface Customer {
  id: string;
  phone: string;
  restaurant: string;
}

/** A customer of its own, at `restaurant` — the same digits elsewhere if given. */
async function customer(
  restaurant = restaurantA,
  phone = `9623${String(++customers).padStart(2, "0")}${String(process.pid).padStart(6, "0").slice(-6)}`,
): Promise<Customer> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [restaurant, phone],
  );
  return { id: rows[0]!.id, phone, restaurant };
}

type Status = "pending_acceptance" | "accepted" | "completed" | "cancelled";

/** An order of `c`'s made `ago` minutes ago, by the database's clock. */
async function createOrder(
  c: Customer,
  status: Status = "accepted",
  ago = 30,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, subtotal,
                         delivery_fee, total, cancelled_by, created_at)
     VALUES ($1, $2, $3, 'pickup', 'cash', $4::order_status,
             CASE WHEN $4 = 'completed' THEN 'collected' ELSE 'pending_cash' END::payment_status,
             5.00, 0, 5.00,
             CASE WHEN $4 = 'cancelled' THEN 'restaurant' END::cancelled_by,
             now() - make_interval(mins => $5))
     RETURNING id`,
    [c.restaurant, c.id, nextNumber++, status, ago],
  );
  return rows[0]!.id;
}

/** A message from `c`, received `ago` minutes ago. */
async function inbound(
  c: Customer,
  ago: number,
  opts: { body?: string | null; type?: string; orderId?: string } = {},
): Promise<string> {
  const body = opts.body === undefined ? "مرحبا" : opts.body;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_messages (restaurant_id, wa_message_id, phone_number_id,
                                   from_phone, message_type, body, payload,
                                   sent_at, received_at, order_id)
     VALUES ($1, $2, 'PHONE_TEST', $3, $4, $5, '{}'::jsonb,
             now() - make_interval(secs => $6), now() - make_interval(secs => $6), $7)
     RETURNING id`,
    [
      c.restaurant,
      `wamid.${RUN}.${++wamid}`,
      c.phone,
      opts.type ?? "text",
      body,
      ago * 60,
      opts.orderId ?? null,
    ],
  );
  return rows[0]!.id;
}

/** A customer who wrote 5 minutes ago, and their order. */
async function open(status: Status = "accepted"): Promise<{
  c: Customer;
  order: string;
}> {
  const c = await customer();
  const order = await createOrder(c, status);
  await inbound(c, 5);
  return { c, order };
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

function headers(restaurant = restaurantA): Record<string, string> {
  return {
    authorization: `Bearer ${token(staffA)}`,
    "x-restaurant-id": restaurant,
    "content-type": "application/json",
  };
}

function post(
  orderId: string,
  body: unknown,
  opts: { restaurant?: string; url?: string } = {},
): Promise<Response> {
  return fetch(`${opts.url ?? baseUrl}/orders/${orderId}/messages`, {
    method: "POST",
    headers: headers(opts.restaurant),
    body: JSON.stringify(body),
  });
}

/** A new message with a clientId of its own — 201 expected. */
async function write(
  orderId: string,
  text = "مرحبا، معك المطعم",
): Promise<StaffOrderMessage> {
  const res = await post(orderId, { text, clientId: randomUUID() });
  expect(res.status).toBe(201);
  return (await res.json()) as CreateStaffMessageResponse;
}

function resume(orderId: string, restaurant = restaurantA): Promise<Response> {
  return fetch(`${baseUrl}/orders/${orderId}/resume-bot`, {
    method: "POST",
    headers: headers(restaurant),
  });
}

async function conversation(orderId: string): Promise<OrderMessagesResponse> {
  const res = await fetch(`${baseUrl}/orders/${orderId}/messages`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderMessagesResponse;
}

async function item(id: string): Promise<OrderListItem | undefined> {
  const res = await fetch(`${baseUrl}/orders?tab=active`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as OrderListResponse;
  return [...body.orders, ...body.returned].find((o) => o.id === id);
}

interface Row {
  id: string;
  order_id: string;
  staff_account_id: string | null;
  client_id: string;
  body: string;
  send_state: string;
  failure: string | null;
  /** `silence_until - created_at`, as Postgres prints an interval. */
  silence: string;
  /** `created_at` as the API writes it in JSON. */
  at: string;
  silence_until: string;
}

/** This restaurant's rows with `clientId` — asked above RLS. */
async function rowsOf(clientId: string): Promise<Row[]> {
  const { rows } = await audit.query<Row>(
    `SELECT id, order_id, staff_account_id, client_id, body, send_state, failure,
            (silence_until - created_at)::text AS silence,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
            to_char(silence_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS silence_until
       FROM staff_messages WHERE client_id = $1`,
    [clientId],
  );
  return rows;
}

/** Every staff message on `orderId` — asked above RLS. */
async function rowsOn(orderId: string): Promise<Row[]> {
  const { rows } = await audit.query<{ client_id: string }>(
    `SELECT client_id FROM staff_messages WHERE order_id = $1 ORDER BY created_at, id`,
    [orderId],
  );
  return (await Promise.all(rows.map((r) => rowsOf(r.client_id)))).flat();
}

async function setState(
  messageId: string,
  state: "sending" | "sent" | "failed",
  failure: string | null = null,
): Promise<void> {
  await audit.query(
    `UPDATE staff_messages SET send_state = $2, failure = $3 WHERE id = $1`,
    [messageId, state, failure],
  );
}

/** The order completed now, by a history row — as the dashboard closes it. */
async function complete(orderId: string): Promise<void> {
  await audit.query(
    `UPDATE orders SET status = 'completed', payment_status = 'collected' WHERE id = $1`,
    [orderId],
  );
  await audit.query(
    `INSERT INTO order_status_history (order_id, restaurant_id, from_status, to_status, actor)
     SELECT id, restaurant_id, 'ready', 'completed', 'system' FROM orders WHERE id = $1`,
    [orderId],
  );
}

/** Moves every message of `c` back by `minutes`, by the database's clock. */
async function ageMessages(c: Customer, minutes: number): Promise<void> {
  await audit.query(
    `UPDATE inbound_messages
        SET received_at = received_at - make_interval(mins => $3)
      WHERE restaurant_id = $1 AND from_phone = $2`,
    [c.restaurant, c.phone, minutes],
  );
}

/** The backends waiting on a lock `pid` holds — asked of Postgres. */
async function waitingOn(pid: number, count: number): Promise<number[]> {
  const deadline = Date.now() + 5_000;
  let pids: number[] = [];
  while (Date.now() < deadline) {
    const { rows } = await audit.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    pids = rows.map((r) => r.pid);
    if (pids.length >= count) return pids;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pids;
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليسأل فوق RLS. انسخ .env.example لـ.env.",
    );
  audit = new Pool({ connectionString: url, max: 3 });

  const api = await startApi();
  app = api.app;
  baseUrl = api.url;
  jwt = app.get(JwtService);

  restaurantA = await createRestaurant("mc3-a");
  restaurantB = await createRestaurant("mc3-b");
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`mc3-a-${RUN}@sufria.test`, STAFF_NAME],
  );
  staffA = rows[0]!.id;
  createdStaff.push(staffA);
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffA, restaurantA],
  );
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (createdRestaurants.length > 0)
      await audit.query(`DELETE FROM restaurants WHERE id = ANY($1::uuid[])`, [
        createdRestaurants,
      ]);
    if (createdStaff.length > 0)
      await audit.query(
        `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
        [createdStaff],
      );
    await audit.end();
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/messages — brief م-ج §4 أ
// ---------------------------------------------------------------------------
describe("POST /orders/:id/messages", () => {
  it("1. a message → 201: the staff member from the token, the text trimmed, a silence of exactly 60 minutes on the database's clock, pending, and the reply in its shape", async () => {
    const { order } = await open();
    const clientId = randomUUID();

    const res = await post(order, {
      text: "  مرحبا، معك المطعم\n",
      clientId,
    });

    expect(res.status).toBe(201);
    const rows = await rowsOf(clientId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      order_id: order,
      staff_account_id: staffA,
      body: "مرحبا، معك المطعم",
      send_state: "pending",
      failure: null,
      silence: "01:00:00",
    });
    expect(await res.json()).toEqual({
      id: row.id,
      direction: "staff",
      kind: "text",
      text: "مرحبا، معك المطعم",
      location: null,
      at: row.at,
      sendState: "pending",
      failure: null,
      staffName: STAFF_NAME,
      clientId,
    });
  });

  it("2. the same clientId on the same order → 200, the same id, one row", async () => {
    const { order } = await open();
    const clientId = randomUUID();
    const first = await post(order, { text: "أول", clientId });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as StaffOrderMessage;

    const again = await post(order, { text: "أول", clientId });

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstBody);
    expect(await rowsOf(clientId)).toHaveLength(1);
  });

  it("3. the same, once the 24 hours closed → 200, not 409", async () => {
    const { c, order } = await open();
    const clientId = randomUUID();
    expect((await post(order, { text: "أول", clientId })).status).toBe(201);
    await ageMessages(c, 1431);

    const again = await post(order, { text: "أول", clientId });

    expect(again.status).toBe(200);
    expect(((await again.json()) as StaffOrderMessage).clientId).toBe(clientId);
    expect(await rowsOf(clientId)).toHaveLength(1);
  });

  it("4. the same clientId on another order → 409 client_id_reused, and no row", async () => {
    const { order } = await open();
    const other = await open();
    const clientId = randomUUID();
    expect((await post(order, { text: "أول", clientId })).status).toBe(201);

    const res = await post(other.order, { text: "أول", clientId });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      statusCode: 409,
      error: "Conflict",
      code: "client_id_reused",
      message: expect.any(String),
    });
    expect((await rowsOf(clientId)).map((r) => r.order_id)).toEqual([order]);
  });

  it("5. 🔴 two presses at the same moment with one clientId → one row, a 201 and a 200", async () => {
    const { order } = await open();
    const clientId = randomUUID();
    const body = { text: "طلبك بعد 10 دقايق", clientId };
    const rival = await startApi();
    const holder = await audit.connect();
    const settle = (res: Promise<Response>) =>
      res.then(async (r) => ({
        status: r.status,
        body: (await r.json()) as unknown,
      }));
    const inFlight: Promise<{ status: number; body: unknown }>[] = [];
    let results: { status: number; body: unknown }[];
    let bothWaited: boolean;
    try {
      // No INSERT into staff_messages gets past this: both requests look for
      // the clientId, find nothing, and stop at their INSERT.
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE staff_messages IN SHARE MODE");
      const { rows } = await holder.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`,
      );
      const holderPid = rows[0]!.pid;

      inFlight.push(settle(post(order, body)));
      inFlight.push(settle(post(order, body, { url: rival.url })));
      bothWaited = (await waitingOn(holderPid, 2)).length === 2;

      await holder.query("COMMIT");
      results = await Promise.all(inFlight);
    } finally {
      await holder.query("ROLLBACK"); // a no-op once committed
      holder.release();
      await Promise.allSettled(inFlight);
      await rival.app.close();
    }

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const rowsNow = await rowsOf(clientId);
    expect(rowsNow).toHaveLength(1);
    for (const r of results)
      expect((r.body as StaffOrderMessage).id).toBe(rowsNow[0]!.id);
    // 🔴 Proof the two really met at the INSERT, rather than ran one after
    //    the other. Last on purpose: without ON CONFLICT this test must fail
    //    above, on a 500.
    expect(bothWaited).toBe(true);
  });

  it("6. «   », 4097 characters, a clientId that is no UUID → 400; exactly 4096 → 201", async () => {
    const { order } = await open();
    for (const body of [
      { text: "   ", clientId: randomUUID() },
      { text: "ب".repeat(4097), clientId: randomUUID() },
      { text: "مرحبا", clientId: "not-a-uuid" },
      { text: "مرحبا" },
      { text: "مرحبا", clientId: randomUUID(), restaurantId: restaurantB },
    ]) {
      const res = await post(order, body);
      expect([JSON.stringify(body).slice(0, 40), res.status]).toEqual([
        JSON.stringify(body).slice(0, 40),
        400,
      ]);
    }
    expect(await rowsOn(order)).toEqual([]);

    // 4096 as WhatsApp counts — characters, not UTF-16 units: an emoji is one.
    const longest = `${"ب".repeat(4095)}😀`;
    const res = await post(order, { text: longest, clientId: randomUUID() });
    expect(res.status).toBe(201);
    expect((await rowsOn(order)).map((r) => r.body)).toEqual([longest]);
  });

  it("7. another restaurant's order → the very 404 of an order that does not exist, and no row", async () => {
    const theirs = await customer(restaurantB);
    const theirOrder = await createOrder(theirs);
    await inbound(theirs, 5);

    for (const id of [theirOrder, NO_SUCH_ORDER]) {
      const res = await post(id, { text: "مرحبا", clientId: randomUUID() });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND_BODY);
    }
    expect(await rowsOn(theirOrder)).toEqual([]);
  });

  it("8. the customer's last message 1431 minutes ago → 409 reply_window_closed; 1429 → 201", async () => {
    const closed = await customer();
    const closedOrder = await createOrder(closed);
    await inbound(closed, 1431);
    const res = await post(closedOrder, {
      text: "مرحبا",
      clientId: randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      statusCode: 409,
      error: "Conflict",
      code: "reply_window_closed",
      message: expect.any(String),
    });
    expect(await rowsOn(closedOrder)).toEqual([]);

    const inside = await customer();
    const insideOrder = await createOrder(inside);
    await inbound(inside, 1429);
    await write(insideOrder);
  });

  it("9. a reaction a minute ago, and text 1431 minutes ago → 409: a reaction does not open the 24 hours", async () => {
    const c = await customer();
    const order = await createOrder(c);
    await inbound(c, 1431);
    await inbound(c, 1, { body: null, type: "reaction" });

    const res = await post(order, { text: "مرحبا", clientId: randomUUID() });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "reply_window_closed",
    );
  });

  it("past the table: no message from the customer at all → 409 reply_window_closed", async () => {
    const c = await customer();
    const order = await createOrder(c);
    const res = await post(order, { text: "مرحبا", clientId: randomUUID() });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "reply_window_closed",
    );
  });

  it("past the table: 🔴 Node's clock a month off either way → the silence is still 60 minutes from the database's now()", async () => {
    const day = 24 * 60 * 60 * 1000;
    for (const offset of [-30 * day, 30 * day]) {
      const { order } = await open();
      const clientId = randomUUID();
      // `Date` alone: timers, the network and the driver run as ever.
      jest.useFakeTimers({
        now: Date.now() + offset,
        doNotFake: [
          "hrtime",
          "nextTick",
          "performance",
          "queueMicrotask",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "requestIdleCallback",
          "cancelIdleCallback",
          "setImmediate",
          "clearImmediate",
          "setInterval",
          "clearInterval",
          "setTimeout",
          "clearTimeout",
        ],
      });
      let status: number;
      try {
        status = (await post(order, { text: "مرحبا", clientId })).status;
      } finally {
        jest.useRealTimers();
      }

      expect([offset, status]).toEqual([offset, 201]);
      const [row] = await rowsOf(clientId);
      expect(row?.silence).toBe("01:00:00");
      expect((await conversation(order)).botSilence).toEqual({
        orderId: order,
        until: row?.silence_until,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /orders/:id/resume-bot — brief م-ج §4 ب
// ---------------------------------------------------------------------------
describe("POST /orders/:id/resume-bot", () => {
  it("10. «رجّع للبوت» → 204 and bot_resumed_at written; another restaurant's order → 404", async () => {
    const { c, order } = await open();
    await write(order);

    const res = await resume(order);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const { rows } = await audit.query<{ resumed: boolean }>(
      `SELECT bot_resumed_at > now() - interval '1 minute' AS resumed
         FROM customers WHERE id = $1`,
      [c.id],
    );
    expect(rows[0]?.resumed).toBe(true);

    const theirs = await customer(restaurantB, c.phone);
    const theirOrder = await createOrder(theirs);
    const refused = await resume(theirOrder);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual(NOT_FOUND_BODY);
    const { rows: theirRow } = await audit.query<{ at: string | null }>(
      `SELECT bot_resumed_at::text AS at FROM customers WHERE id = $1`,
      [theirs.id],
    );
    expect(theirRow[0]?.at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /orders/:id/messages — brief م-ج §4 ج
// ---------------------------------------------------------------------------
describe("GET /orders/:id/messages", () => {
  it("11. staff messages pending (and sending), sent and failed → direction staff, each state and failure, the staff name, in time order with the rest", async () => {
    const { c, order } = await open();
    // Relayed to the order (brief م-أ), so it is the order's whatever its
    // time — the 5 minutes' message of `open` is after the order and no
    // order's yet (rule 5).
    await inbound(c, 3, { body: "وين طلبي؟", orderId: order });
    const pending = await write(order, "واحد");
    const sent = await write(order, "اتنين");
    const failed = await write(order, "تلاتة");
    const sending = await write(order, "أربعة");
    await setState(sent.id, "sent");
    await setState(failed.id, "failed", "send_failed");
    await setState(sending.id, "sending");

    const { messages } = await conversation(order);

    expect(messages.map((m) => [m.direction, m.text])).toEqual([
      ["inbound", "وين طلبي؟"],
      ["staff", "واحد"],
      ["staff", "اتنين"],
      ["staff", "تلاتة"],
      ["staff", "أربعة"],
    ]);
    const staff = messages.filter(
      (m): m is StaffOrderMessage => m.direction === "staff",
    );
    expect(
      staff.map((m) => [m.id, m.sendState, m.failure, m.staffName]),
    ).toEqual([
      [pending.id, "pending", null, STAFF_NAME],
      [sent.id, "sent", null, STAFF_NAME],
      [failed.id, "failed", "send_failed", STAFF_NAME],
      [sending.id, "pending", null, STAFF_NAME],
    ]);
    expect(staff[0]).toEqual(pending);
  });

  it("past the table: the account gone → staffName null, the message kept", async () => {
    const { order } = await open();
    const { rows } = await audit.query<{ id: string }>(
      `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
       VALUES ($1, 'x', 'موظف راح') RETURNING id`,
      [`mc3-gone-${RUN}@sufria.test`],
    );
    const gone = rows[0]!.id;
    const message = await write(order);
    await audit.query(
      `UPDATE staff_messages SET staff_account_id = $2 WHERE id = $1`,
      [message.id, gone],
    );
    await audit.query(`DELETE FROM staff_accounts WHERE id = $1`, [gone]);

    const { messages } = await conversation(order);

    expect(messages.find((m) => m.id === message.id)).toMatchObject({
      direction: "staff",
      staffName: null,
    });
  });

  it("12. a staff message on the same customer's order B is not in order A's conversation", async () => {
    const { c, order: a } = await open();
    const b = await createOrder(c, "accepted", 10);
    const onB = await write(b, "على طلب ب");

    const ofA = (await conversation(a)).messages.map((m) => m.id);
    const ofB = (await conversation(b)).messages.map((m) => m.id);

    expect(ofA).not.toContain(onB.id);
    expect(ofB).toContain(onB.id);
  });

  it("13. botSilence: before → null · after a POST → {orderId, until} · after resume-bot → null · after the order closed → null · after a POST on the closed order → not null · the only one failed → null", async () => {
    const { order } = await open();
    expect((await conversation(order)).botSilence).toBeNull();

    const first = await write(order);
    const [row] = await rowsOf(first.clientId);
    expect((await conversation(order)).botSilence).toEqual({
      orderId: order,
      until: row?.silence_until,
    });

    expect((await resume(order)).status).toBe(204);
    expect((await conversation(order)).botSilence).toBeNull();

    await write(order);
    expect((await conversation(order)).botSilence).not.toBeNull();
    await complete(order);
    expect((await conversation(order)).botSilence).toBeNull();

    // Decision 2: a complaint after the order closed silences again.
    const complaint = await write(order, "آسفين، رح نعوّضك");
    const [complaintRow] = await rowsOf(complaint.clientId);
    expect((await conversation(order)).botSilence).toEqual({
      orderId: order,
      until: complaintRow?.silence_until,
    });

    const lone = await open();
    const failed = await write(lone.order);
    await setState(failed.id, "failed", "send_failed");
    expect((await conversation(lone.order)).botSilence).toBeNull();
  });

  it("past the table: botSilence names the order of the staff message — another order of the same customer's", async () => {
    const { c, order: a } = await open();
    const b = await createOrder(c, "accepted", 10);
    await write(b);

    expect((await conversation(a)).botSilence).toMatchObject({ orderId: b });
  });

  it("14. replyOpenUntil: their last message + 1430 minutes · passed → null · no message → null", async () => {
    const { c, order } = await open();
    const { rows } = await audit.query<{ until: string }>(
      `SELECT to_char((max(received_at) + interval '1430 minutes') AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS until
         FROM inbound_messages WHERE restaurant_id = $1 AND from_phone = $2`,
      [c.restaurant, c.phone],
    );
    expect((await conversation(order)).replyOpenUntil).toBe(rows[0]?.until);

    await ageMessages(c, 1431);
    expect((await conversation(order)).replyOpenUntil).toBeNull();

    const silent = await customer();
    const silentOrder = await createOrder(silent);
    expect((await conversation(silentOrder)).replyOpenUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /orders — staffMessagedAt (brief م-ج §4 د)
// ---------------------------------------------------------------------------
describe("GET /orders — staffMessagedAt", () => {
  it("15. before → null · after a POST → its time · the only one failed → null · an order in returned → there", async () => {
    const { order } = await open();
    expect((await item(order))?.staffMessagedAt).toBeNull();

    const message = await write(order);
    expect((await item(order))?.staffMessagedAt).toBe(message.at);

    const lone = await open();
    const failed = await write(lone.order);
    await setState(failed.id, "failed", "send_failed");
    expect((await item(lone.order))?.staffMessagedAt).toBeNull();

    // A closed order a customer message brought back (brief م-ب).
    const back = await open("completed");
    await inbound(back.c, 2, { body: "الأكل كان بارد", orderId: back.order });
    const reply = await write(back.order, "آسفين");
    const res = await fetch(`${baseUrl}/orders?tab=active`, {
      headers: headers(),
    });
    const body = (await res.json()) as OrderListResponse;
    expect(body.orders.map((o) => o.id)).not.toContain(back.order);
    expect(
      body.returned.find((o) => o.id === back.order)?.staffMessagedAt,
    ).toBe(reply.at);
  });
});
