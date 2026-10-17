/**
 * mc-4 · the bot keeps quiet for a customer a staff member is talking to —
 * brief م-ج §5, on a real database, with the recording sender.
 *
 * The harness of customer-relay.test.ts. Staff messages are written straight
 * to `staff_messages` from the audit connection, as the dashboard API writes
 * them — `silence_until` = `created_at` + 60 minutes — and aged with
 * `now() - interval`, as briefs ح, ك and م-أ age their rows: the rule
 * (`app.bot_silence()`, 0018) reads what is there, however it got there.
 *
 * The numbers are the brief's table's (§5).
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
  ConversationService,
  flushDeferred,
  type ConversationContext,
  type ConversationOutcome,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { OrderNotifier } from "../src/notify/order-notifier.js";
import { parseWebhookPayload } from "../src/whatsapp/payload.js";
import { SavingWhatsAppSender } from "../src/whatsapp/saving-sender.js";
import {
  RecordingWhatsAppSender,
  type OutboundTextMessage,
} from "../src/whatsapp/sender.js";
import { WebhookService } from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();
const NAME = `مطعم السكوت ${RUN}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96273${String(++customerSeq).padStart(7, "0")}`;

/** `{}` = always open. */
const ALWAYS_OPEN_HOURS = {};
/** No open day at all — «closed» without depending on the clock. */
const ALWAYS_CLOSED_HOURS = {
  days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
};
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
async function shop(label: string): Promise<Shop> {
  const pid = `PHONE.SILENCE.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours, contact_phone)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4)
     RETURNING id`,
    [NAME, pid, JSON.stringify(ALWAYS_OPEN_HOURS), PHONE],
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
 * finished one gets a history row `finishedMinutesAgo` back.
 */
async function pastOrder(
  s: Shop,
  from: string,
  spec: {
    number: number;
    status: OrderStatus;
    ageMinutes: number;
    finishedMinutesAgo?: number;
  },
): Promise<string> {
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2)
     ON CONFLICT (restaurant_id, phone_number) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [s.id, from],
  );
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         notified, subtotal, total, ready_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'pickup', 'cash', $4::order_status,
             CASE WHEN $4 = 'completed' THEN 'collected' ELSE 'pending_cash' END::payment_status,
             CASE WHEN $4 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             true, 5.00, 5.00,
             CASE WHEN $4 IN ('ready', 'completed') THEN now() END,
             now() - make_interval(mins => $5), now() - make_interval(mins => $5))
     RETURNING id`,
    [s.id, customer.rows[0]?.id, spec.number, spec.status, spec.ageMinutes],
  );
  const orderId = rows[0]?.id ?? "";
  if (spec.finishedMinutesAgo !== undefined)
    await finish(s, orderId, spec.status, spec.finishedMinutesAgo);
  return orderId;
}

/** A history row: the order reached `to` `minutesAgo` back. */
async function finish(
  s: Shop,
  orderId: string,
  to: OrderStatus,
  minutesAgo: number,
): Promise<void> {
  await audit.query(
    `INSERT INTO order_status_history (order_id, restaurant_id, from_status, to_status,
                                       actor, changed_at)
     VALUES ($1, $2, 'ready', $3::order_status, 'system',
             now() - make_interval(mins => $4))`,
    [orderId, s.id, to, minutesAgo],
  );
}

/**
 * A staff message on `orderId`, written `ageMinutes` ago as the dashboard
 * API writes it: `silence_until` 60 minutes after it.
 */
async function staffMessage(
  s: Shop,
  orderId: string,
  spec: {
    ageMinutes: number;
    state?: "pending" | "sending" | "sent" | "failed";
  },
): Promise<string> {
  const state = spec.state ?? "pending";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_messages (restaurant_id, order_id, client_id, body, send_state,
                                 failure, created_at, silence_until)
     VALUES ($1, $2, $3, 'مرحبا، معك المطعم', $4,
             CASE WHEN $4 = 'failed' THEN 'send_failed' END,
             now() - make_interval(mins => $5),
             now() - make_interval(mins => $5) + interval '60 minutes')
     RETURNING id`,
    [s.id, orderId, randomUUID(), state, spec.ageMinutes],
  );
  return rows[0]?.id ?? "";
}

interface Customer {
  from: string;
  say: (
    body: string | null,
    opts?: { type?: string },
  ) => Promise<{ outcome: ConversationOutcome; orderId: string | null }>;
  /** The replies to this customer since the last `say`. */
  sent: () => OutboundTextMessage[];
  /** The one reply to the last `say`. */
  reply: () => string;
  /** `bot_resumed_at` as text, or null. */
  resumedAt: () => Promise<string | null>;
  /** «رجّع للبوت», as the dashboard writes it, `minutesAgo` back. */
  resumed: (minutesAgo: number) => Promise<void>;
  /** `relay_replied_at` as text, or null. */
  repliedAt: () => Promise<string | null>;
  /** The active session's cart, streak and `last_message_at`. */
  session: () => Promise<{
    state: string;
    cart: string[];
    streak: number | null;
    last: string;
  } | null>;
}

function customer(s: Shop, from = nextCustomer()): Customer {
  const sent = (): OutboundTextMessage[] =>
    replies.forRestaurant(s.id).filter((m) => m.to === from);
  const column = async (name: string): Promise<string | null> => {
    const { rows } = await audit.query<{ at: string | null }>(
      `SELECT ${name}::text AS at FROM customers
        WHERE restaurant_id = $1 AND phone_number = $2`,
      [s.id, from],
    );
    return rows[0]?.at ?? null;
  };
  return {
    from,
    say: async (body, opts = {}) => {
      replies.reset();
      const deferred: DeferredSend[] = [];
      const relayed: ConversationContext["relayed"] = { orderId: null };
      const outcome = await db.runInTenant(s.id, (tx) =>
        conversation.handleInbound(tx, {
          restaurantId: s.id,
          phoneNumberId: s.pid,
          from,
          body,
          deferred,
          messageType: opts.type ?? "text",
          relayed,
        }),
      );
      await flushDeferred(conversation.sender, deferred);
      return { outcome, orderId: relayed.orderId };
    },
    sent,
    reply: () => {
      const all = sent();
      expect(all).toHaveLength(1);
      return all[0]?.body ?? "";
    },
    resumedAt: () => column("bot_resumed_at"),
    resumed: async (minutesAgo) => {
      const { rowCount } = await audit.query(
        `UPDATE customers SET bot_resumed_at = now() - make_interval(mins => $3)
          WHERE restaurant_id = $1 AND phone_number = $2`,
        [s.id, from, minutesAgo],
      );
      expect(rowCount).toBe(1);
    },
    repliedAt: () => column("relay_replied_at"),
    session: async () => {
      const { rows } = await audit.query<{
        state: string;
        cart: { item_id: string }[] | null;
        streak: number | null;
        last: string;
      }>(
        `SELECT s.state::text AS state, s.context->'cart' AS cart,
                (s.context->>'unparsed_streak')::int AS streak,
                s.last_message_at::text AS last
           FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2
            AND s.state NOT IN ('order_placed', 'abandoned')`,
        [s.id, from],
      );
      const row = rows[0];
      return row
        ? { ...row, cart: (row.cart ?? []).map((l) => l.item_id) }
        : null;
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

/** A customer with an order on its way (108, preparing) and a staff message a minute old. */
async function silenced(
  label: string,
  state: "pending" | "sent" = "pending",
): Promise<{ s: Shop; c: Customer; order: string }> {
  const s = await shop(label);
  const c = customer(s);
  const order = await pastOrder(s, c.from, {
    number: 108,
    status: "preparing",
    ageMinutes: 20,
  });
  await staffMessage(s, order, { ageMinutes: 1, state });
  return { s, c, order };
}

const RELAY_108 =
  "نحضّر طلبك رقم 108 الآن.\n" +
  "وصلت رسالتك للمطعم.\n" +
  "للتواصل مباشرة: 0790000099\n" +
  "لطلب جديد، اكتب «منيو».";

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
// The silence and what ends it
// ---------------------------------------------------------------------------

describe("the bot keeps quiet — brief م-ج §5", () => {
  it("1. an order on its way and a pending staff message a minute old, «تمام» → bot_silent: no reply, linked to the order, relay_replied_at untouched", async () => {
    const { c, order } = await silenced("t1");

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent()).toEqual([]);
    expect(await c.repliedAt()).toBeNull();
    expect(await c.session()).toBeNull();
  });

  it("2. the same with the message sent → the same", async () => {
    const { c, order } = await silenced("t2", "sent");

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent()).toEqual([]);
    expect(await c.repliedAt()).toBeNull();
  });

  it("3. the only staff message failed → the relay line (brief م-أ)", async () => {
    const s = await shop("t3");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 20,
    });
    await staffMessage(s, order, { ageMinutes: 1, state: "failed" });

    expect(await c.say("تمام")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(RELAY_108);
  });

  it("4. 🔴 the latest failed, one sent 10 minutes before it → bot_silent, as the sent one made it (decision 10)", async () => {
    const s = await shop("t4");
    const c = customer(s);
    const sentOn = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 40,
    });
    const failedOn = await pastOrder(s, c.from, {
      number: 109,
      status: "preparing",
      ageMinutes: 20,
    });
    await staffMessage(s, sentOn, { ageMinutes: 11, state: "sent" });
    // On another order, so the failed one would name its own if it counted.
    await staffMessage(s, failedOn, { ageMinutes: 1, state: "failed" });

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: sentOn,
    });
    expect(c.sent()).toEqual([]);
  });

  it("5. the latest message's silence_until passed → today's path (the relay line)", async () => {
    const s = await shop("t5");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 90,
    });
    await staffMessage(s, order, { ageMinutes: 61, state: "sent" });

    expect(await c.say("تمام")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(RELAY_108);
  });

  it("6. 🔴 «منيو» during the silence → greeted and the menu, bot_resumed_at written, and the next message is not kept quiet", async () => {
    const { c } = await silenced("t6");

    expect(await c.say("منيو")).toEqual({ outcome: "greeted", orderId: null });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
    expect(await c.resumedAt()).not.toBeNull();

    // The session «منيو» opened takes it, as today.
    expect((await c.say("وين طلبي؟")).outcome).toBe("browsing");
    expect(c.sent()).toHaveLength(1);
  });

  it.each(["المنيو", "القائمه"])(
    "7. «%s» during the silence → as 6",
    async (word) => {
      const { c } = await silenced(`t7-${word}`);

      expect(await c.say(word)).toEqual({ outcome: "greeted", orderId: null });
      expect(isWelcomeAndMenu(c.reply())).toBe(true);
      expect(await c.resumedAt()).not.toBeNull();
    },
  );

  it("8. bot_resumed_at after the message («رجّع للبوت») → today's path", async () => {
    const { c, order } = await silenced("t8");
    await c.resumed(0);

    expect(await c.say("تمام")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(RELAY_108);
  });

  it("9. a staff message after bot_resumed_at → bot_silent", async () => {
    const s = await shop("t9");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 20,
    });
    await staffMessage(s, order, { ageMinutes: 10 });
    await c.resumed(5);
    await staffMessage(s, order, { ageMinutes: 1 });

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
  });

  it("10. the order completed after the message (its history row) → the finished order's relay line", async () => {
    const s = await shop("t10");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "completed",
      ageMinutes: 30,
    });
    await staffMessage(s, order, { ageMinutes: 10 });
    await finish(s, order, "completed", 2);

    expect(await c.say("شكرا")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.reply()).toBe(
      "وصلت رسالتك للمطعم بخصوص طلبك رقم 108.\n" +
        "للتواصل مباشرة: 0790000099\n" +
        "لطلب جديد، اكتب «منيو».",
    );
  });

  it("11. 🔴 the order completed before the message (a complaint) → bot_silent (decision 2)", async () => {
    const s = await shop("t11");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "completed",
      ageMinutes: 30,
      finishedMinutesAgo: 10,
    });
    await staffMessage(s, order, { ageMinutes: 2 });

    expect(await c.say("الأكل كان بارد")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent()).toEqual([]);
  });

  it("12. the order cancelled after the message → today's path", async () => {
    const s = await shop("t12");
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "cancelled",
      ageMinutes: 30,
    });
    await staffMessage(s, order, { ageMinutes: 10 });
    await finish(s, order, "cancelled", 2);

    expect(await c.say("ليش؟")).toEqual({ outcome: "relayed", orderId: order });
    expect(c.sent()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// It beats everything but a reaction — decision 3
// ---------------------------------------------------------------------------

describe("the silence beats everything but a reaction — decision 3", () => {
  /** A browsing session with «حمص» in the cart, then a staff message. */
  async function midCart(label: string): Promise<{
    s: Shop;
    c: Customer;
    order: string;
  }> {
    const s = await shop(label);
    const c = customer(s);
    const order = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 20,
    });
    expect((await c.say("منيو")).outcome).toBe("greeted");
    expect((await c.say("2")).outcome).toBe("browsing");
    expect((await c.say("شو هاد؟")).outcome).toBe("browsing");
    await staffMessage(s, order, { ageMinutes: 0 });
    return { s, c, order };
  }

  it("13. 🔴 a browsing session under way and the silence, «1» → bot_silent: the cart as it was, last_message_at untouched, the streak not grown", async () => {
    const { s, c, order } = await midCart("t13");
    const before = await c.session();
    expect(before).toMatchObject({
      state: "browsing",
      cart: [s.ids["حمص"]],
      streak: 1,
    });

    expect(await c.say("1")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent()).toEqual([]);
    expect(await c.session()).toEqual(before);
  });

  it("14. the same, then bot_resumed_at, «1» → browsing and the item added: the cart waited", async () => {
    const { s, c } = await midCart("t14");
    expect((await c.say("1")).outcome).toBe("bot_silent");
    await c.resumed(0);

    expect(await c.say("1")).toEqual({ outcome: "browsing", orderId: null });
    expect((await c.session())?.cart).toEqual([
      s.ids["حمص"],
      s.ids["شاورما عربي"],
    ]);
  });

  it("15. 🔴 the restaurant closed by its hours, and the silence → bot_silent, not the closing text", async () => {
    const { s, c, order } = await silenced("t15");
    await audit.query(
      `UPDATE restaurants SET business_hours = $2::jsonb WHERE id = $1`,
      [s.id, JSON.stringify(ALWAYS_CLOSED_HOURS)],
    );

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent().map((m) => m.body)).not.toContain(CLOSED_AR);
    expect(c.sent()).toEqual([]);
  });

  it("16. orders paused, and the silence → bot_silent, not the paused text", async () => {
    const { s, c, order } = await silenced("t16");
    await audit.query(
      `UPDATE restaurants SET orders_paused_at = now() WHERE id = $1`,
      [s.id],
    );

    expect(await c.say("تمام")).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent().map((m) => m.body)).not.toContain(ORDERS_PAUSED_AR);
    expect(c.sent()).toEqual([]);
  });

  it("17. a voice note (body NULL) during the silence → bot_silent, linked", async () => {
    const { c, order } = await silenced("t17");

    expect(await c.say(null, { type: "audio" })).toEqual({
      outcome: "bot_silent",
      orderId: order,
    });
    expect(c.sent()).toEqual([]);
  });

  it("18. a reaction during the silence → reaction_ignored: no link", async () => {
    const { c } = await silenced("t18");

    expect(await c.say(null, { type: "reaction" })).toEqual({
      outcome: "reaction_ignored",
      orderId: null,
    });
    expect(c.sent()).toEqual([]);
  });

  it("19. the same number kept quiet at another restaurant → today's path here", async () => {
    const there = await silenced("t19-there");
    const here = await shop("t19-here");
    const c = customer(here, there.c.from);

    expect(await c.say("مرحبا")).toEqual({ outcome: "greeted", orderId: null });
    expect(isWelcomeAndMenu(c.reply())).toBe(true);
  });

  it("20. the silence on order A, and a newer order B on its way → linked to A", async () => {
    const s = await shop("t20");
    const c = customer(s);
    const a = await pastOrder(s, c.from, {
      number: 108,
      status: "preparing",
      ageMinutes: 40,
    });
    await staffMessage(s, a, { ageMinutes: 1 });
    const b = await pastOrder(s, c.from, {
      number: 109,
      status: "pending_acceptance",
      ageMinutes: 5,
    });

    const said = await c.say("وين طلبي التاني؟");
    expect(said).toEqual({ outcome: "bot_silent", orderId: a });
    expect(said.orderId).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// End to end, and the notifier
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

describe("through the webhook, and the notifier", () => {
  it("21. end to end during the silence → the inbound row carries the silence's order, and no outbound_messages row", async () => {
    const { s, c, order } = await silenced("t21");
    const webhook = new WebhookService(
      db,
      new ConversationService(new SavingWhatsAppSender(replies, saveDb)),
    );
    const wamid = `wamid.SILENCE.${RUN}.21`;

    expect(
      await webhook.ingest(delivery(s.pid, c.from, wamid, "تمام")),
    ).toEqual(["stored"]);

    const inbound = await audit.query<{ order_id: string | null }>(
      `SELECT order_id FROM inbound_messages
        WHERE restaurant_id = $1 AND wa_message_id = $2`,
      [s.id, wamid],
    );
    expect(inbound.rows).toEqual([{ order_id: order }]);
    const outbound = await audit.query(
      `SELECT 1 FROM outbound_messages WHERE restaurant_id = $1 AND to_phone = $2`,
      [s.id, c.from],
    );
    expect(outbound.rowCount).toBe(0);
    expect(c.sent()).toEqual([]);
  });

  it("22. a status notification during the silence → sent as today (decision 11)", async () => {
    const { s, c, order } = await silenced("t22");
    await audit.query(
      `UPDATE orders SET status = 'ready', ready_at = now(), notified = false
        WHERE id = $1`,
      [order],
    );
    const notifier = new OrderNotifier(db, replies, {
      sleep: async () => undefined,
      restaurantScope: [s.id],
    });

    await notifier.tick();

    expect(c.sent().map((m) => m.body)).toEqual([
      "طلبك رقم 108 جاهز للاستلام.",
    ]);
  });
});
