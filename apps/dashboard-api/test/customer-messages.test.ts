/**
 * م-ب-4 — a customer's messages on the board (brief م-ب §5, tests 1–19):
 * `unreadMessages` and `lastMessage` on every item of `GET /orders` (and of
 * the reply of `PATCH /orders/:id/status`), the closed orders a message
 * brings back (`returned`), `POST /orders/:id/messages/seen`, and the
 * messages with no text in `GET /orders/:id/messages`.
 *
 * The harness of order-messages.test.ts: the real AppModule over real HTTP,
 * as `sufria_dashboard` with RLS live; fixtures written through
 * MIGRATION_DATABASE_URL. Every time here is the database's — `now()` minus
 * minutes — because `returned`'s 24 hours are measured by its clock. Each
 * test has orders of its own, in two restaurants of this suite's own, so the
 * lists are exact.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type {
  OrderListItem,
  OrderListResponse,
  OrderMessage,
  OrderMessagesResponse,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `mb4-${process.pid}-${Date.now()}`;
const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };
/** Well-formed, and no message anywhere. */
const NO_SUCH_MESSAGE = "f0000000-0000-4000-8000-0000000000fd";

const PHONE_X = `9627${String(process.pid).padStart(8, "0").slice(-8)}`;
const PHONE_Y = `9625${String(process.pid).padStart(8, "0").slice(-8)}`;

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let restaurantA = "";
let restaurantB = "";
let staffA = "";
let customerX = "";
let customerB = "";
let ownCustomers = 0;
let nextNumber = 501;
let wamid = 0;

async function createStaff(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`${label}-${RUN}@sufria.test`, `موظف ${label}`],
  );
  const id = rows[0]!.id;
  createdStaff.push(id);
  return id;
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

async function createCustomer(
  restaurant: string,
  phone: string,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [restaurant, phone],
  );
  return rows[0]!.id;
}

/**
 * A customer of A for one test alone: rule 3's window runs from the
 * customer's order before, and customer X has orders of every test.
 */
async function ownCustomer(): Promise<{ customer: string; phone: string }> {
  const phone = `9626${++ownCustomers}${String(process.pid).padStart(7, "0").slice(-7)}`;
  return { customer: await createCustomer(restaurantA, phone), phone };
}

type Status = "pending_acceptance" | "accepted" | "completed" | "cancelled";

/** An order made `ago` minutes ago, by the database's clock. */
async function createOrder(
  status: Status,
  ago = 120,
  restaurant = restaurantA,
  customer = customerX,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, subtotal,
                         delivery_fee, total, cancelled_by, cancellation_reason,
                         created_at)
     VALUES ($1, $2, $3, 'pickup', 'cash', $4::order_status,
             CASE WHEN $4 = 'completed' THEN 'collected' ELSE 'pending_cash' END::payment_status,
             5.00, 0, 5.00,
             CASE WHEN $4 = 'cancelled' THEN 'restaurant' END::cancelled_by,
             CASE WHEN $4 = 'cancelled' THEN 'نفد الخبز' END,
             now() - make_interval(mins => $5))
     RETURNING id`,
    [restaurant, customer, nextNumber++, status, ago],
  );
  return rows[0]!.id;
}

/**
 * A customer's message received `ago` minutes ago. `body: null` is a
 * message with no text, of `type`. `orderId`: the order the engine relayed
 * it to (brief م-أ), or none.
 */
async function inbound(
  ago: number,
  body: string | null,
  opts: {
    orderId?: string;
    type?: string;
    phone?: string;
    restaurant?: string;
    payload?: unknown;
  } = {},
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_messages (restaurant_id, wa_message_id, phone_number_id,
                                   from_phone, message_type, body, payload,
                                   sent_at, received_at, order_id)
     VALUES ($1, $2, 'PHONE_TEST', $3, $4, $5, $6::jsonb,
             now() - make_interval(secs => $7), now() - make_interval(secs => $7), $8)
     RETURNING id`,
    [
      opts.restaurant ?? restaurantA,
      `wamid.${RUN}.${++wamid}`,
      opts.phone ?? PHONE_X,
      opts.type ?? (body === null ? "image" : "text"),
      body,
      JSON.stringify(opts.payload ?? {}),
      ago * 60,
      opts.orderId ?? null,
    ],
  );
  return rows[0]!.id;
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

async function list(tab: "active" | "history"): Promise<OrderListResponse> {
  const res = await fetch(`${baseUrl}/orders?tab=${tab}`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderListResponse;
}

async function item(id: string): Promise<OrderListItem | undefined> {
  const body = await list("active");
  return [...body.orders, ...body.returned].find((o) => o.id === id);
}

const ids = (items: OrderListItem[]): string[] => items.map((o) => o.id);

function seen(orderId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/orders/${orderId}/messages/seen`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

async function seenOk(orderId: string, upTo: string): Promise<void> {
  const res = await seen(orderId, { upTo });
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
}

async function seenAt(orderId: string): Promise<string | null> {
  const { rows } = await audit.query<{ at: string | null }>(
    `SELECT customer_messages_seen_at::text AS at FROM orders WHERE id = $1`,
    [orderId],
  );
  return rows[0]!.at;
}

async function messages(orderId: string): Promise<OrderMessage[]> {
  const res = await fetch(`${baseUrl}/orders/${orderId}/messages`, {
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as OrderMessagesResponse).messages;
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليسأل فوق RLS. انسخ .env.example لـ.env.",
    );
  audit = new Pool({ connectionString: url, max: 2 });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  jwt = app.get(JwtService);

  restaurantA = await createRestaurant("mb4-a");
  restaurantB = await createRestaurant("mb4-b");
  staffA = await createStaff("mb4-a");
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffA, restaurantA],
  );
  customerX = await createCustomer(restaurantA, PHONE_X);
  await createCustomer(restaurantA, PHONE_Y);
  customerB = await createCustomer(restaurantB, PHONE_X);
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

describe("GET /orders — unreadMessages and lastMessage (brief م-ب)", () => {
  it("1. an order on its way with no message relayed to it: 0, and no last message", async () => {
    const order = await createOrder("accepted");
    expect(await item(order)).toMatchObject({
      unreadMessages: 0,
      lastMessage: null,
    });
  });

  it("2. three messages relayed to it: 3, and the latest of them", async () => {
    const order = await createOrder("accepted");
    await inbound(30, "وين طلبي؟", { orderId: order });
    await inbound(20, "؟", { orderId: order });
    await inbound(10, "لسا بستنى", { orderId: order });
    expect(await item(order)).toMatchObject({
      unreadMessages: 3,
      lastMessage: { kind: "text", text: "لسا بستنى" },
    });
  });

  it("3. a message before the order (relayed to none) never counts", async () => {
    const { customer, phone } = await ownCustomer();
    const order = await createOrder("accepted", 60, restaurantA, customer);
    await inbound(61, "منيو", { phone });
    await inbound(60.5, "1", { phone });
    expect(await item(order)).toMatchObject({
      unreadMessages: 0,
      lastMessage: null,
    });
  });

  it("4. a voice note relayed to it: kind audio, text null", async () => {
    const order = await createOrder("accepted");
    await inbound(5, null, { orderId: order, type: "audio" });
    expect(await item(order)).toMatchObject({
      unreadMessages: 1,
      lastMessage: { kind: "audio", text: null },
    });
  });

  it("5. a 300-character text: its first 200 alone", async () => {
    const order = await createOrder("accepted");
    const long = "أ".repeat(150) + "b".repeat(150);
    await inbound(5, long, { orderId: order });
    const last = (await item(order))?.lastMessage;
    expect(last?.text).toBe(long.slice(0, 200));
    expect([...(last?.text ?? "")].length).toBe(200);
  });
});

describe("POST /orders/:id/messages/seen (brief م-ب)", () => {
  it("6–7. seen up to the last message: 0; a message after it: 1", async () => {
    const order = await createOrder("accepted");
    await inbound(20, "أول", { orderId: order });
    const last = await inbound(10, "تاني", { orderId: order });

    await seenOk(order, last);
    expect(await item(order)).toMatchObject({
      unreadMessages: 0,
      // Read, and still the latest: the card shows no bubble, by its count.
      lastMessage: { kind: "text", text: "تاني" },
    });

    await inbound(1, "تالت", { orderId: order });
    expect((await item(order))?.unreadMessages).toBe(1);
  });

  it("🔴 8. seen on a message older than the last seen: seen_at does not move back", async () => {
    const order = await createOrder("accepted");
    const older = await inbound(20, "أول", { orderId: order });
    const newer = await inbound(10, "تاني", { orderId: order });

    await seenOk(order, newer);
    const after = await seenAt(order);
    await seenOk(order, older);
    expect(await seenAt(order)).toBe(after);
    expect((await item(order))?.unreadMessages).toBe(0);
  });

  it("seen_at is the message's own received_at, not the clock — and nothing else of the order changes", async () => {
    const order = await createOrder("accepted");
    const m = await inbound(10, "وين؟", { orderId: order });
    const before = await audit.query(
      `SELECT status, notified, updated_at::text,
              (SELECT count(*) FROM order_status_history h WHERE h.order_id = o.id) AS history
         FROM orders o WHERE id = $1`,
      [order],
    );
    await seenOk(order, m);
    const { rows } = await audit.query<{ same: boolean }>(
      `SELECT o.customer_messages_seen_at = i.received_at AS same
         FROM orders o, inbound_messages i WHERE o.id = $1 AND i.id = $2`,
      [order, m],
    );
    expect(rows[0]!.same).toBe(true);
    const after = await audit.query(
      `SELECT status, notified, updated_at::text,
              (SELECT count(*) FROM order_status_history h WHERE h.order_id = o.id) AS history
         FROM orders o WHERE id = $1`,
      [order],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("14. another customer's message · another restaurant's order · no such message: 404 alike", async () => {
    const order = await createOrder("accepted");
    await inbound(10, "لي", { orderId: order });
    const theirs = await inbound(5, "مش إلك", { phone: PHONE_Y });
    const orderOfB = await createOrder("accepted", 120, restaurantB, customerB);
    const ofB = await inbound(5, "ب", {
      restaurant: restaurantB,
      orderId: orderOfB,
    });

    for (const [orderId, upTo] of [
      [order, theirs],
      [orderOfB, ofB],
      [order, NO_SUCH_MESSAGE],
    ] as const) {
      const res = await seen(orderId, { upTo });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND_BODY);
    }
    expect(await seenAt(order)).toBeNull();
    expect(await seenAt(orderOfB)).toBeNull();
  });

  it("15. no upTo, or one that is not a UUID: 400", async () => {
    const order = await createOrder("accepted");
    for (const body of [{}, { upTo: "1" }, { upTo: 7 }]) {
      const res = await seen(order, body);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /orders — returned: closed orders a message brought back (brief م-ب)", () => {
  it("9–10. a cancelled order with an unread message an hour old: in returned, not in orders — and out once seen", async () => {
    const order = await createOrder("cancelled", 180);
    const m = await inbound(60, "ليش انلغى؟", { orderId: order });

    let body = await list("active");
    expect(ids(body.returned)).toContain(order);
    expect(ids(body.orders)).not.toContain(order);
    expect(body.returned.find((o) => o.id === order)).toMatchObject({
      status: "cancelled",
      cancellationReason: "نفد الخبز",
      unreadMessages: 1,
      lastMessage: { kind: "text", text: "ليش انلغى؟" },
    });

    await seenOk(order, m);
    body = await list("active");
    expect(ids(body.returned)).not.toContain(order);
  });

  it("🔴 11. the same, with the message 25 hours old: not in returned", async () => {
    const order = await createOrder("completed", 26 * 60);
    await inbound(25 * 60, "الطلب ناقص", { orderId: order });
    expect(ids((await list("active")).returned)).not.toContain(order);
  });

  it("12. two returned orders: the newest unread message first", async () => {
    const older = await createOrder("completed", 300);
    const newer = await createOrder("completed", 200);
    // The order made first has the newest message.
    await inbound(30, "ناقص", { orderId: older });
    await inbound(90, "شكرا", { orderId: newer });
    const returned = ids((await list("active")).returned);
    const two = returned.filter((id) => id === older || id === newer);
    expect(two).toEqual([older, newer]);
  });

  it("13. tab=history: returned is always [], and the order is still in history", async () => {
    const order = await createOrder("completed", 100);
    await inbound(30, "ناقص", { orderId: order });
    const body = await list("history");
    expect(body.returned).toEqual([]);
    expect(ids(body.orders)).toContain(order);
  });

  it("an order on its way with an unread message is in orders, never in returned", async () => {
    const order = await createOrder("pending_acceptance");
    await inbound(5, "وين؟", { orderId: order });
    const body = await list("active");
    expect(ids(body.orders)).toContain(order);
    expect(ids(body.returned)).not.toContain(order);
  });
});

describe("GET /orders/:id/messages — messages with no text (brief م-ب)", () => {
  it("16. a voice note, an image and a location relayed to the order: each by its kind, the location with its point", async () => {
    const order = await createOrder("accepted");
    const voice = await inbound(30, null, { orderId: order, type: "audio" });
    const image = await inbound(20, null, { orderId: order, type: "image" });
    const where = await inbound(10, null, {
      orderId: order,
      type: "location",
      payload: {
        type: "location",
        location: { latitude: 31.9539, longitude: -35.9106, name: "بيت" },
      },
    });
    const shown = await messages(order);
    expect(
      shown.map(({ id, kind, text, location }) => ({
        id,
        kind,
        text,
        location,
      })),
    ).toEqual([
      { id: voice, kind: "audio", text: null, location: null },
      { id: image, kind: "image", text: null, location: null },
      {
        id: where,
        kind: "location",
        text: null,
        location: { latitude: 31.9539, longitude: -35.9106 },
      },
    ]);
  });

  it("a location whose coordinates are not numbers: kind location, no point", async () => {
    const order = await createOrder("accepted");
    await inbound(10, null, {
      orderId: order,
      type: "location",
      payload: { location: { latitude: "31.9", longitude: "35.9" } },
    });
    expect((await messages(order))[0]).toMatchObject({
      kind: "location",
      location: null,
    });
  });

  it("17. an image before the order (relayed to none): not shown — rule 3 stays text alone", async () => {
    const { customer, phone } = await ownCustomer();
    const order = await createOrder("accepted", 60, restaurantA, customer);
    await inbound(62, "منيو", { phone });
    const image = await inbound(61, null, { type: "image", phone });
    const shown = await messages(order);
    expect(shown.map((m) => m.text)).toEqual(["منيو"]);
    expect(shown.map((m) => m.id)).not.toContain(image);
  });

  it("🔴 18. a reaction relayed to the order (UPDATE from above RLS): never shown", async () => {
    const order = await createOrder("accepted");
    const reaction = await inbound(5, null, { type: "reaction" });
    await audit.query(
      `UPDATE inbound_messages SET order_id = $1 WHERE id = $2`,
      [order, reaction],
    );
    expect((await messages(order)).map((m) => m.id)).not.toContain(reaction);
    // Nor counted on the card.
    expect((await item(order))?.unreadMessages).toBe(0);
  });

  it("an image relayed to the customer's other order: not this order's", async () => {
    const first = await createOrder("completed", 300);
    const second = await createOrder("accepted", 100);
    const image = await inbound(50, null, { orderId: first, type: "image" });
    expect((await messages(second)).map((m) => m.id)).not.toContain(image);
    expect((await messages(first)).map((m) => m.id)).toContain(image);
  });
});

describe("PATCH /orders/:id/status (brief م-ب)", () => {
  it("19. the reply carries unreadMessages and lastMessage", async () => {
    const order = await createOrder("pending_acceptance");
    await inbound(3, "بسرعة لو سمحت", { orderId: order });
    const res = await fetch(`${baseUrl}/orders/${order}/status`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ from: "pending_acceptance", to: "accepted" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "accepted",
      unreadMessages: 1,
      lastMessage: { kind: "text", text: "بسرعة لو سمحت" },
    });
  });
});
