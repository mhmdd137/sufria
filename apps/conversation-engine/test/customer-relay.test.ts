/**
 * ma-3 · a customer's message after an order reaches the restaurant — brief
 * م-أ §4, on a real database, with the recording sender.
 *
 * Orders are written straight to the tables from the audit connection, their
 * age by `created_at = now() - interval` and a finished order's moment by its
 * history row's `changed_at`, as briefs ح and ك age theirs: the rule reads
 * what is there, however it got there. The quiet minutes are aged the same
 * way, on `customers.relay_replied_at`. Every expected line is written out by
 * hand, to the letter.
 *
 * The numbers are the brief's table's (§4); what is added past it says so.
 * Test 23 — the notifier's texts with their number — is notifier.test.ts's
 * 1, 3 and 5.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  CLOSED_AR,
  MENU_HEADER_AR,
  ORDERS_PAUSED_AR,
  welcomeMessageAr,
  type OrderStatus,
} from "@sufria/shared";

import {
  decideRelay,
  isRelayReplyDue,
  type RelayMinutes,
} from "../src/conversation/customer-relay.js";
import {
  ConversationService,
  flushDeferred,
  type ConversationContext,
  type ConversationOutcome,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { parseWebhookPayload } from "../src/whatsapp/payload.js";
import { SavingWhatsAppSender } from "../src/whatsapp/saving-sender.js";
import {
  RecordingWhatsAppSender,
  type OutboundTextMessage,
  type WhatsAppSender,
} from "../src/whatsapp/sender.js";
import {
  WebhookService,
  needsRedelivery,
} from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();
const NAME = `مطعم الرسائل ${RUN}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96274${String(++customerSeq).padStart(7, "0")}`;

/** `{}` = always open. */
const ALWAYS_OPEN_HOURS = {};
/** No open day at all — «closed» without depending on the clock. */
const ALWAYS_CLOSED_HOURS = {
  days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
};
/** The fixture's number, as in the brief's three shapes. */
const PHONE = "0790000099";

let db: TenantDb;
let saveDb: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface Shop {
  id: string;
  pid: string;
  /** item name → id */
  ids: Record<string, string>;
}

/** An always-open restaurant with two items, and `contact_phone` = PHONE. */
async function shop(
  label: string,
  opts: { contactPhone?: string | null } = {},
): Promise<Shop> {
  const pid = `PHONE.RELAY.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours, contact_phone)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4)
     RETURNING id`,
    [
      NAME,
      pid,
      JSON.stringify(ALWAYS_OPEN_HOURS),
      opts.contactPhone === undefined ? PHONE : opts.contactPhone,
    ],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [id],
  );
  const ids: Record<string, string> = {};
  for (const [i, item] of [
    { name: "شاورما عربي", price: "6.00" },
    { name: "حمص", price: "2.50" },
  ].entries()) {
    const r = await audit.query<{ id: string }>(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, cat.rows[0]?.id, item.name, item.price, i],
    );
    ids[item.name] = r.rows[0]?.id ?? "";
  }
  return { id, pid, ids };
}

/**
 * An order of `from` at `s`, `ageMinutes` old by the database's clock. A
 * finished one gets a history row `finishedMinutesAgo` back — its finishing
 * moment, as `orders.service.ts` reads it — or none, which reads as its
 * `created_at`.
 */
async function pastOrder(
  s: Shop,
  from: string,
  spec: {
    number: number;
    status: OrderStatus;
    ageMinutes: number;
    fulfillment?: "pickup" | "delivery";
    finishedMinutesAgo?: number;
  },
): Promise<string> {
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2)
     ON CONFLICT (restaurant_id, phone_number) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [s.id, from],
  );
  const fulfillment = spec.fulfillment ?? "pickup";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         notified, subtotal, total, delivery_address, ready_at,
                         created_at, updated_at)
     VALUES ($1, $2, $3, $4::fulfillment_type, 'cash', $5::order_status,
             CASE WHEN $5 = 'completed' THEN 'collected' ELSE 'pending_cash' END::payment_status,
             CASE WHEN $5 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             true, 5.00, 5.00,
             CASE WHEN $4 = 'delivery' THEN 'شارع الجامعة، بناية 12' END,
             CASE WHEN $5 IN ('ready', 'completed') THEN now() END,
             now() - make_interval(mins => $6), now() - make_interval(mins => $6))
     RETURNING id`,
    [
      s.id,
      customer.rows[0]?.id,
      spec.number,
      fulfillment,
      spec.status,
      spec.ageMinutes,
    ],
  );
  const orderId = rows[0]?.id ?? "";
  if (spec.finishedMinutesAgo !== undefined) {
    await audit.query(
      `INSERT INTO order_status_history (order_id, restaurant_id, from_status, to_status,
                                         actor, changed_at)
       VALUES ($1, $2, 'ready', $3::order_status, 'system',
               now() - make_interval(mins => $4))`,
      [orderId, s.id, spec.status, spec.finishedMinutesAgo],
    );
  }
  return orderId;
}

interface Customer {
  from: string;
  /** One message, as the webhook hands it over; the outcome and the link. */
  say: (
    body: string | null,
    opts?: { type?: string; service?: ConversationService },
  ) => Promise<{ outcome: ConversationOutcome; orderId: string | null }>;
  /** The replies to this customer since the last `say`. */
  sent: () => OutboundTextMessage[];
  /** The one reply to the last `say`. */
  reply: () => string;
  /** This customer's sessions' states, oldest first. */
  sessions: () => Promise<string[]>;
  /** `relay_replied_at` as text (microseconds kept), or null. */
  repliedAt: () => Promise<string | null>;
  /** Moves `relay_replied_at` back, by the database's clock. */
  repliedAgo: (interval: string) => Promise<void>;
}

function customer(s: Shop, from = nextCustomer()): Customer {
  const sent = (): OutboundTextMessage[] =>
    replies.forRestaurant(s.id).filter((m) => m.to === from);
  return {
    from,
    say: async (body, opts = {}) => {
      replies.reset();
      const service = opts.service ?? conversation;
      const deferred: DeferredSend[] = [];
      const relayed: ConversationContext["relayed"] = { orderId: null };
      const outcome = await db.runInTenant(s.id, (tx) =>
        service.handleInbound(tx, {
          restaurantId: s.id,
          phoneNumberId: s.pid,
          from,
          body,
          deferred,
          messageType: opts.type ?? "text",
          relayed,
        }),
      );
      await flushDeferred(service.sender, deferred);
      return { outcome, orderId: relayed.orderId };
    },
    sent,
    reply: () => {
      const all = sent();
      expect(all).toHaveLength(1);
      return all[0]?.body ?? "";
    },
    sessions: async () => {
      const { rows } = await audit.query<{ state: string }>(
        `SELECT s.state::text AS state FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2
          ORDER BY s.created_at, s.id`,
        [s.id, from],
      );
      return rows.map((r) => r.state);
    },
    repliedAt: async () => {
      const { rows } = await audit.query<{ at: string | null }>(
        `SELECT relay_replied_at::text AS at FROM customers
          WHERE restaurant_id = $1 AND phone_number = $2`,
        [s.id, from],
      );
      return rows[0]?.at ?? null;
    },
    repliedAgo: async (interval) => {
      const { rowCount } = await audit.query(
        `UPDATE customers SET relay_replied_at = now() - $3::interval
          WHERE restaurant_id = $1 AND phone_number = $2`,
        [s.id, from, interval],
      );
      expect(rowCount).toBe(1);
    },
  };
}

/** The welcome and the menu in one message — as `deliverMenu` sends them. */
function isWelcomeAndMenu(body: string | undefined): boolean {
  return (
    body !== undefined &&
    body.startsWith(welcomeMessageAr(NAME)) &&
    body.includes(MENU_HEADER_AR) &&
    body.includes("شاورما عربي")
  );
}

/** Lets the event loop run long enough for another transaction to block. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL is missing — see .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  saveDb = new TenantDb();
  await saveDb.start();
  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await db.stop();
  await saveDb.stop();
  if (createdRestaurants.length > 0) {
    // The cascade takes customers, orders, sessions and messages along.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

describe("the relay line — brief م-أ §4", () => {
  it("1. pending_acceptance 10 minutes old, «وين طلبي؟» → the first shape to the letter, linked, no session, relay_replied_at, and outbound_messages keeps it under the order", async () => {
    const s = await shop("t1");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    const saving = new ConversationService(
      new SavingWhatsAppSender(replies, saveDb),
    );

    expect(await c.say("وين طلبي؟", { service: saving })).toEqual({
      outcome: "relayed",
      orderId: order,
    });
    const line =
      "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».";
    expect(c.reply()).toBe(line);
    expect(c.sent()[0]?.orderId).toBe(order);
    expect(await c.sessions()).toEqual([]);
    expect(await c.repliedAt()).not.toBeNull();

    const { rows: kept } = await audit.query<{
      to_phone: string;
      body: string;
      order_id: string | null;
    }>(
      `SELECT to_phone, body, order_id FROM outbound_messages WHERE restaurant_id = $1`,
      [s.id],
    );
    expect(kept).toEqual([{ to_phone: c.from, body: line, order_id: order }]);
  });

  it("2. the same at a restaurant with no contact_phone → three lines, no contact line", async () => {
    const s = await shop("t2", { contactPhone: null });
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });

    expect((await c.say("وين طلبي؟")).outcome).toBe("relayed");
    expect(c.reply()).toBe(
      "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("3. a second message 3 minutes after the line → no reply, still linked, the quiet minutes not restarted", async () => {
    const s = await shop("t3");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    await c.say("وين طلبي؟");
    await c.repliedAgo("3 minutes");
    const before = await c.repliedAt();

    expect(await c.say("؟")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.sent()).toEqual([]);
    expect(await c.repliedAt()).toBe(before);
    expect(await c.sessions()).toEqual([]);
  });

  it("4. a message 11 minutes after the line → the line again, and relay_replied_at is now", async () => {
    const s = await shop("t4");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 30,
    });
    await c.say("وين طلبي؟");
    await c.repliedAgo("11 minutes");

    expect(await c.say("لسا؟")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(
      "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
    const { rows } = await audit.query<{ fresh: boolean }>(
      `SELECT relay_replied_at > now() - interval '1 minute' AS fresh
         FROM customers WHERE restaurant_id = $1 AND phone_number = $2`,
      [s.id, c.from],
    );
    expect(rows[0]?.fresh).toBe(true);
  });

  it("5. accepted · preparing · ready for pickup · ready for delivery → each one's own first line", async () => {
    const s = await shop("t5");
    for (const [status, fulfillment, first] of [
      ["accepted", "pickup", "أكّدنا طلبك رقم 201."],
      ["preparing", "pickup", "نحضّر طلبك رقم 202 الآن."],
      ["ready", "pickup", "طلبك رقم 203 جاهز للاستلام."],
      ["ready", "delivery", "طلبك رقم 204 خرج للتوصيل."],
    ] as const) {
      const c = customer(s);
      const number = Number(/\d+/u.exec(first)?.[0]);
      await pastOrder(s, c.from, {
        number,
        status,
        fulfillment,
        ageMinutes: 20,
      });

      expect((await c.say("وين طلبي؟")).outcome).toBe("relayed");
      expect(c.reply()).toBe(
        `${first}\n` +
          "وصلت رسالتك للمطعم.\n" +
          "للتواصل مباشرة: 0790000099\n" +
          "لطلب جديد، اكتب «منيو».",
      );
    }
  });

  it("6. two orders on their way (107 ready, 108 preparing) → both lines oldest first, the second shape, linked to 108", async () => {
    const s = await shop("t6");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 107,
      status: "ready",
      ageMinutes: 40,
    });
    const newest = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 10,
    });

    expect(await c.say("وين طلبي؟")).toEqual({
      outcome: "relayed",
      orderId: newest,
    });
    expect(c.reply()).toBe(
      "طلبك رقم 107 جاهز للاستلام.\n" +
        "نحضّر طلبك رقم 108 الآن.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("7. an order on its way made 181 minutes ago → the existing path: greeted and the menu, no link", async () => {
    const s = await shop("t7");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "accepted",
      ageMinutes: 181,
    });

    expect(await c.say("مرحبا")).toEqual({
      outcome: "greeted",
      orderId: null,
    });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
    expect(await c.sessions()).toEqual(["browsing"]);
    expect(await c.repliedAt()).toBeNull();
  });

  it("8. made 2 hours ago, completed 30 minutes ago (by its history row) → the finished order's line, linked to it", async () => {
    const s = await shop("t8");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "completed",
      ageMinutes: 120,
      finishedMinutesAgo: 30,
    });

    expect(await c.say("الطلب ناقص")).toEqual({
      outcome: "relayed",
      orderId: order,
    });
    expect(c.reply()).toBe(
      "وصلت رسالتك للمطعم بخصوص طلبك رقم 108.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
    expect(await c.sessions()).toEqual([]);
  });

  it("9. the same, completed 61 minutes ago → the existing path", async () => {
    const s = await shop("t9");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "completed",
      ageMinutes: 120,
      finishedMinutesAgo: 61,
    });

    expect(await c.say("مرحبا")).toEqual({
      outcome: "greeted",
      orderId: null,
    });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
  });

  it("10. cancelled 10 minutes ago → the finished order's line", async () => {
    const s = await shop("t10");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "cancelled",
      ageMinutes: 30,
      finishedMinutesAgo: 10,
    });

    expect(await c.say("ليش؟")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(
      "وصلت رسالتك للمطعم بخصوص طلبك رقم 108.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("11. an order on its way and one finished 10 minutes ago → the one on its way wins", async () => {
    const s = await shop("t11");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 107,
      status: "completed",
      ageMinutes: 60,
      finishedMinutesAgo: 10,
    });
    const open = await pastOrder(s, c.from, {
      number: 108,
      status: "accepted",
      ageMinutes: 30,
    });

    expect(await c.say("وين طلبي؟")).toEqual({
      outcome: "relayed",
      orderId: open,
    });
    expect(c.reply()).toBe(
      "أكّدنا طلبك رقم 108.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("12. «منيو» with an order on its way → greeted, the menu, a new session — no link", async () => {
    const s = await shop("t12");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });

    expect(await c.say("منيو")).toEqual({ outcome: "greeted", orderId: null });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
    expect(await c.sessions()).toEqual(["browsing"]);
    expect(await c.repliedAt()).toBeNull();
  });

  it("13. a browsing session under way (after «منيو») and an order on its way, «2» → browsing, the item added — no link", async () => {
    const s = await shop("t13");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    await c.say("منيو");

    expect(await c.say("2")).toEqual({ outcome: "browsing", orderId: null });
    const { rows } = await audit.query<{ cart: { item_id: string }[] }>(
      `SELECT s.context->'cart' AS cart FROM conversation_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
      [s.id, c.from],
    );
    expect(rows[0]?.cart.map((l) => l.item_id)).toEqual([s.ids["حمص"]]);
    expect(await c.repliedAt()).toBeNull();
  });

  it("14. the restaurant closed by its hours, and an order on its way → the line, not the closing text", async () => {
    const s = await shop("t14");
    await audit.query(
      `UPDATE restaurants SET business_hours = $2::jsonb WHERE id = $1`,
      [s.id, JSON.stringify(ALWAYS_CLOSED_HOURS)],
    );
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 10,
    });

    expect(await c.say("وين طلبي؟")).toEqual({
      outcome: "relayed",
      orderId: order,
    });
    expect(c.reply()).not.toBe(CLOSED_AR);
    expect(c.reply()).toBe(
      "نحضّر طلبك رقم 108 الآن.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("15. orders paused, and an order on its way → the line, not the paused text", async () => {
    const s = await shop("t15");
    await audit.query(
      `UPDATE restaurants SET orders_paused_at = now() WHERE id = $1`,
      [s.id],
    );
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 10,
    });

    expect(await c.say("وين طلبي؟")).toEqual({
      outcome: "relayed",
      orderId: order,
    });
    expect(c.reply()).not.toBe(ORDERS_PAUSED_AR);
    expect(c.reply()).toBe(
      "نحضّر طلبك رقم 108 الآن.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("16. a voice note (body NULL, audio) and an order on its way → relayed, and the line", async () => {
    const s = await shop("t16");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "accepted",
      ageMinutes: 10,
    });

    expect(await c.say(null, { type: "audio" })).toEqual({
      outcome: "relayed",
      orderId: order,
    });
    expect(c.reply()).toBe(
      "أكّدنا طلبك رقم 108.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("19. the same number has an order on its way at another restaurant → the existing path here", async () => {
    const here = await shop("t19-here");
    const there = await shop("t19-there");
    const from = nextCustomer();
    await pastOrder(there, from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    const c = customer(here, from);

    expect(await c.say("مرحبا")).toEqual({ outcome: "greeted", orderId: null });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reactions — decision 9
// ---------------------------------------------------------------------------

describe("a reaction is stored, and nothing else — decision 9", () => {
  it("17. a reaction with an order on its way → reaction_ignored: no reply, no link, relay_replied_at untouched", async () => {
    const s = await shop("t17");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "ready",
      ageMinutes: 10,
    });

    expect(await c.say(null, { type: "reaction" })).toEqual({
      outcome: "reaction_ignored",
      orderId: null,
    });
    expect(c.sent()).toEqual([]);
    expect(await c.repliedAt()).toBeNull();
    expect(await c.sessions()).toEqual([]);
  });

  it("18. a reaction in a browsing session → reaction_ignored: no reply, the streak as it was, last_message_at untouched", async () => {
    const s = await shop("t18");
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("شو هاد؟");
    const read = async (): Promise<{ streak: number; last: string }> => {
      const { rows } = await audit.query<{ streak: number; last: string }>(
        `SELECT (s.context->>'unparsed_streak')::int AS streak,
                s.last_message_at::text AS last
           FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [s.id, c.from],
      );
      return rows[0] ?? { streak: -1, last: "" };
    };
    const before = await read();
    expect(before.streak).toBe(1);

    expect(await c.say(null, { type: "reaction" })).toEqual({
      outcome: "reaction_ignored",
      orderId: null,
    });
    expect(c.sent()).toEqual([]);
    expect(await read()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Through the webhook — the row's order_id
// ---------------------------------------------------------------------------

/** One text message from `from` to `pid`, as Meta delivers it. */
function delivery(
  pid: string,
  from: string,
  waMessageId: string,
  body: string,
): NonNullable<ReturnType<typeof parseWebhookPayload>> {
  const parsed = parseWebhookPayload({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "962790000000",
                phone_number_id: pid,
              },
              messages: [
                {
                  from,
                  id: waMessageId,
                  timestamp: "1757000000",
                  type: "text",
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  if (parsed === null) throw new Error("the payload did not parse");
  return parsed;
}

async function storedRows(
  s: Shop,
  waMessageId: string,
): Promise<{ order_id: string | null }[]> {
  const { rows } = await audit.query<{ order_id: string | null }>(
    `SELECT order_id FROM inbound_messages
      WHERE restaurant_id = $1 AND wa_message_id = $2`,
    [s.id, waMessageId],
  );
  return rows;
}

/** Fails every send — a network error, a 5xx from Meta. */
class FailingSender implements WhatsAppSender {
  async sendText(): Promise<void> {
    throw new Error("send failed on purpose");
  }
}

describe("the webhook writes the link on the message's own row", () => {
  it("20. end to end: a message after an order on its way → its row carries the order; a message with no order → order_id NULL", async () => {
    const s = await shop("t20");
    const webhook = new WebhookService(db, conversation);
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    const other = nextCustomer();

    expect(
      await webhook.ingest(
        delivery(s.pid, c.from, `wamid.RELAY.${RUN}.20a`, "وين طلبي؟"),
      ),
    ).toEqual(["stored"]);
    expect(
      await webhook.ingest(
        delivery(s.pid, other, `wamid.RELAY.${RUN}.20b`, "مرحبا"),
      ),
    ).toEqual(["stored"]);

    expect(await storedRows(s, `wamid.RELAY.${RUN}.20a`)).toEqual([
      { order_id: order },
    ]);
    expect(await storedRows(s, `wamid.RELAY.${RUN}.20b`)).toEqual([
      { order_id: null },
    ]);
  });

  it("21. 🔴 the send fails → the transaction rolls back: no relay_replied_at, no row and no order_id, and the outcome asks Meta to deliver again", async () => {
    const s = await shop("t21");
    const webhook = new WebhookService(
      db,
      new ConversationService(new FailingSender()),
    );
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });

    const outcomes = await webhook.ingest(
      delivery(s.pid, c.from, `wamid.RELAY.${RUN}.21`, "وين طلبي؟"),
    );

    expect(outcomes).toEqual(["failed"]);
    expect(needsRedelivery(outcomes)).toBe(true);
    expect(await storedRows(s, `wamid.RELAY.${RUN}.21`)).toEqual([]);
    expect(await c.repliedAt()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two messages at the same moment — the customer's row lock
// ---------------------------------------------------------------------------

describe("the quiet minutes under the row lock", () => {
  /**
   * 🔴 **Ordered, not raced** (CLAUDE.md): the winner relays and holds its
   *    transaction open; the loser starts then, and blocks on `FOR UPDATE` on
   *    the customer's row. After the winner's COMMIT it reads the winner's
   *    `relay_replied_at`, and keeps quiet. A `Promise.all` passes or fails
   *    with the machine's load.
   */
  it("22. two messages at the same moment → one line only", async () => {
    const s = await shop("t22");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 10,
    });
    const ctx = (body: string): ConversationContext => ({
      restaurantId: s.id,
      phoneNumberId: s.pid,
      from: c.from,
      body,
      deferred: [],
      messageType: "text",
      relayed: { orderId: null },
    });
    const first = ctx("وين طلبي؟");
    const second = ctx("؟");

    const winnerDb = new TenantDb();
    await winnerDb.start();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    let loserWaitedOnLock: boolean;
    let outcomes: ConversationOutcome[];
    try {
      const winner = winnerDb.runInTenant(s.id, async (tx) => {
        const outcome = await conversation.handleInbound(tx, first);
        await winnerHeld;
        return outcome;
      });
      await settle();
      const loser = db.runInTenant(s.id, (tx) =>
        conversation.handleInbound(tx, second),
      );
      await settle();
      // A snapshot while the winner holds on: the loser waits on the
      // customer's row, at the quiet minutes' read.
      const { rows: waiting } = await audit.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%relay_replied_at%'
            AND query ILIKE '%for update%'`,
      );
      loserWaitedOnLock = waiting.length === 1;
      releaseWinner();
      outcomes = await Promise.all([winner, loser]);
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    // 1. One line — the point. Printed first, so a break shows why.
    expect(replies.forRestaurant(s.id).map((m) => m.body)).toEqual([
      "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
        "وصلت رسالتك للمطعم.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    ]);
    // 2. Both messages relayed to the order.
    expect(outcomes).toEqual(["relayed", "relayed"]);
    expect([first.relayed.orderId, second.relayed.orderId]).toEqual([
      order,
      order,
    ]);
    // 3. 🔴 Proof the two were concurrent, not one after the other. Last on
    //    purpose: without the lock, the test must fail at 1.
    expect(loserWaitedOnLock).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Past the table
// ---------------------------------------------------------------------------

describe("past the table", () => {
  /**
   * 🔴 Every time is the database's clock, like brief ح's test 9: the
   *    service's clock is injected a month off the database's; were any of
   *    the three windows measured on it, an answer below would flip.
   */
  it("the times are the database's clock: Node's a month behind does not make a 181-minute-old order young, nor a month ahead a 10-minute-old one — or the quiet minutes — old", async () => {
    const day = 24 * 60 * 60 * 1000;
    const behind = new ConversationService(
      replies,
      () => new Date(Date.now() - 30 * day),
    );
    const ahead = new ConversationService(
      replies,
      () => new Date(Date.now() + 30 * day),
    );
    const s = await shop("t-clock");

    const old = customer(s);
    await pastOrder(s, old.from, {
      number: 107,
      status: "accepted",
      ageMinutes: 181,
    });
    expect((await old.say("مرحبا", { service: behind })).outcome).toBe(
      "greeted",
    );

    const recent = customer(s);
    await pastOrder(s, recent.from, {
      number: 108,
      status: "accepted",
      ageMinutes: 10,
    });
    expect((await recent.say("وين؟", { service: ahead })).outcome).toBe(
      "relayed",
    );
    expect(recent.sent()).toHaveLength(1);
    // The line went 3 minutes ago by the database's clock: quiet, whatever
    // Node's says.
    await recent.repliedAgo("3 minutes");
    expect((await recent.say("؟", { service: ahead })).outcome).toBe("relayed");
    expect(recent.sent()).toEqual([]);
  });

  it("the windows are the service's (the laptop trial's minutes): at 4 / 2 / 1, an order 5 minutes old is the menu, one 3 minutes old relays", async () => {
    const minutes: RelayMinutes = {
      openOrderMax: 4,
      closedOrder: 2,
      replyQuiet: 1,
    };
    const trial = new ConversationService(
      replies,
      undefined,
      undefined,
      undefined,
      minutes,
    );
    const s = await shop("t-env");

    const five = customer(s);
    await pastOrder(s, five.from, {
      number: 107,
      status: "pending_acceptance",
      ageMinutes: 5,
    });
    expect((await five.say("مرحبا", { service: trial })).outcome).toBe(
      "greeted",
    );

    const three = customer(s);
    await pastOrder(s, three.from, {
      number: 108,
      status: "pending_acceptance",
      ageMinutes: 3,
    });
    expect((await three.say("مرحبا", { service: trial })).outcome).toBe(
      "relayed",
    );
  });

  it("an expired order is neither on its way nor finished → the existing path", async () => {
    const s = await shop("t-expired");
    const c = customer(s);
    await pastOrder(s, c.from, {
      number: 108,
      status: "expired",
      ageMinutes: 30,
      finishedMinutesAgo: 5,
    });

    expect((await c.say("مرحبا")).outcome).toBe("greeted");
  });

  it("the quiet minutes' edge, on the pure decision: 9:59 quiet · 10:00 due · never sent: due", () => {
    // Not through the database: its clock moves between setting and reading
    // (brief ح test 3's reason).
    expect(isRelayReplyDue(9 * 60 + 59, 10)).toBe(false);
    expect(isRelayReplyDue(599.999, 10)).toBe(false);
    expect(isRelayReplyDue(10 * 60, 10)).toBe(true);
    expect(isRelayReplyDue(10 * 60 + 1, 10)).toBe(true);
    expect(isRelayReplyDue(null, 10)).toBe(true);
    // And the trial's one minute.
    expect(isRelayReplyDue(59, 1)).toBe(false);
    expect(isRelayReplyDue(60, 1)).toBe(true);
  });

  it("decideRelay: on its way beats finished, the newest is linked, nothing is nothing", () => {
    const a = {
      id: "a",
      orderNumber: 107,
      status: "ready" as const,
      fulfillmentType: "pickup" as const,
    };
    const b = { ...a, id: "b", orderNumber: 108, status: "preparing" as const };
    const done = { id: "done", orderNumber: 106 };

    expect(decideRelay([a, b], done)).toEqual({
      orderId: "b",
      subject: {
        kind: "open",
        orders: [
          { orderNumber: 107, status: "ready", fulfillmentType: "pickup" },
          { orderNumber: 108, status: "preparing", fulfillmentType: "pickup" },
        ],
      },
    });
    expect(decideRelay([], done)).toEqual({
      orderId: "done",
      subject: { kind: "closed", orderNumber: 106 },
    });
    expect(decideRelay([], null)).toBeNull();
  });
});
