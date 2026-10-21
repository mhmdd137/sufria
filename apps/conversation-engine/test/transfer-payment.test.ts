/**
 * mha-3 · the restaurant's payment method in the summary and the order —
 * brief م-هـ-أ §5, on a real database.
 *
 * Every test builds its restaurant through the audit connection above RLS,
 * talks to `handleInbound` as the webhook does, and reads `orders` back from
 * there. A transfer restaurant's summary carries ن1 in the cash line's
 * place, and «أكّد» writes `transfer` / `pending_transfer` — the method the
 * restaurant has at that moment, in that transaction. A cash restaurant is
 * exactly as before. «استلمنا» does not change.
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
  SUMMARY_PAYMENT_LINE_AR,
  orderReceivedMessageAr,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const N1 = "الدفع بالتحويل، ونرسل لك التفاصيل مع تأكيد الطلب.";
const DETAILS = "جوال باي 059XXXXXXX (عرض تجريبي)";
const CONFIRM = "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».";

let customerSeq = 0;
const nextCustomer = (): string =>
  `96279${String(++customerSeq).padStart(7, "0")}`;

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface Shop {
  id: string;
  pid: string;
  ids: Record<string, string>;
}

/** An always-open ILS restaurant with two items, paid as `payment` says. */
async function shop(
  label: string,
  opts: { payment: "cash" | "transfer"; offersDelivery?: boolean },
): Promise<Shop> {
  const pid = `PHONE.TRANSFER.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              offers_delivery, delivery_fee, currency,
                              payment_method, transfer_details)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb, $3, $4, 'ILS',
             $5::payment_method, $6)
     RETURNING id`,
    [
      `مطعم غزة ${label} ${RUN}`,
      pid,
      opts.offersDelivery ?? false,
      opts.offersDelivery ? "3.00" : "0",
      opts.payment,
      opts.payment === "transfer" ? DETAILS : null,
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

interface Customer {
  from: string;
  /** One message; the replies to it, in order. */
  say: (body: string) => Promise<string[]>;
}

function customer(s: Shop, from = nextCustomer()): Customer {
  return {
    from,
    say: async (body) => {
      replies.reset();
      const deferred: DeferredSend[] = [];
      await db.runInTenant(s.id, (tx) =>
        conversation.handleInbound(tx, {
          restaurantId: s.id,
          phoneNumberId: s.pid,
          from,
          body,
          deferred,
          messageType: "text",
          relayed: { orderId: null },
        }),
      );
      await flushDeferred(conversation.sender, deferred);
      return replies
        .forRestaurant(s.id)
        .filter((m) => m.to === from)
        .map((m) => m.body);
    },
  };
}

async function ordersOf(
  s: Shop,
): Promise<{ payment_method: string; payment_status: string }[]> {
  const { rows } = await audit.query<{
    payment_method: string;
    payment_status: string;
  }>(
    `SELECT payment_method::text, payment_status::text
       FROM orders WHERE restaurant_id = $1 ORDER BY created_at`,
    [s.id],
  );
  return rows;
}

const PICKUP_SUMMARY = (payment: string): string =>
  [
    "ملخّص طلبك:",
    "1 · شاورما عربي ×2 — 12 شيكل",
    "المجموع 12 شيكل",
    "الاستلام من المطعم",
    payment,
    CONFIRM,
  ].join("\n");

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0)
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  await audit.end();
});

describe("the summary (ن1)", () => {
  it("🔴 a transfer restaurant, pickup: the summary carries ن1 in the cash line's place", async () => {
    const s = await shop("pickup", { payment: "transfer" });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");

    expect(await c.say("تم")).toEqual([PICKUP_SUMMARY(N1)]);
  });

  it("a transfer restaurant, delivery: ن1 after the address line", async () => {
    const s = await shop("delivery", {
      payment: "transfer",
      offersDelivery: true,
    });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");
    await c.say("تم");
    await c.say("توصيل");

    expect(await c.say("الرمال، شارع عمر المختار، بناية 4")).toEqual([
      [
        "ملخّص طلبك:",
        "1 · شاورما عربي ×2 — 12 شيكل",
        "التوصيل — 3 شيكل",
        "المجموع 15 شيكل",
        "التوصيل إلى: الرمال، شارع عمر المختار، بناية 4",
        N1,
        CONFIRM,
      ].join("\n"),
    ]);
  });

  it("a cash restaurant: «الدفع نقدا.», exactly as before", async () => {
    const s = await shop("cash", { payment: "cash" });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");

    expect(await c.say("تم")).toEqual([
      PICKUP_SUMMARY(SUMMARY_PAYMENT_LINE_AR),
    ]);
  });

  it("«نفسه» (brief ك) at a transfer restaurant → the summary carries ن1", async () => {
    const s = await shop("reorder", { payment: "transfer" });
    const c = customer(s);
    const customerRow = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
      [s.id, c.from],
    );
    const past = await audit.query<{ id: string }>(
      `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                           payment_method, status, payment_status, notified,
                           subtotal, total, created_at, updated_at)
       VALUES ($1, $2, 101, 'pickup', 'transfer', 'completed', 'collected', true,
               12.00, 12.00, now() - interval '1 day', now() - interval '1 day')
       RETURNING id`,
      [s.id, customerRow.rows[0]?.id],
    );
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, menu_item_id,
                                item_name_snapshot, unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, 'شاورما عربي', 6.00, 2)`,
      [past.rows[0]?.id, s.id, s.ids["شاورما عربي"]],
    );
    const [first] = await c.say("مرحبا");
    expect(first).toContain("آخر طلب لك:");

    expect(await c.say("نفسه")).toEqual([PICKUP_SUMMARY(N1)]);
  });
});

describe("«أكّد» (the order's payment)", () => {
  it("🔴 a transfer restaurant → transfer / pending_transfer, and «استلمنا» as it was", async () => {
    const s = await shop("confirm", { payment: "transfer" });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");
    await c.say("تم");

    expect(await c.say("أكّد")).toEqual([orderReceivedMessageAr(101)]);
    expect(await ordersOf(s)).toEqual([
      { payment_method: "transfer", payment_status: "pending_transfer" },
    ]);
  });

  it("a cash restaurant → cash / pending_cash, as before", async () => {
    const s = await shop("confirm-cash", { payment: "cash" });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");
    await c.say("تم");

    expect(await c.say("أكّد")).toEqual([orderReceivedMessageAr(101)]);
    expect(await ordersOf(s)).toEqual([
      { payment_method: "cash", payment_status: "pending_cash" },
    ]);
  });

  it("the method the restaurant has at «أكّد», not the summary's: back to cash in between → a cash order", async () => {
    const s = await shop("switch", { payment: "transfer" });
    const c = customer(s);
    await c.say("مرحبا");
    await c.say("1 ×2");
    expect((await c.say("تم"))[0]).toContain(N1);
    await audit.query(
      `UPDATE restaurants SET payment_method = 'cash' WHERE id = $1`,
      [s.id],
    );

    await c.say("أكّد");
    expect(await ordersOf(s)).toEqual([
      { payment_method: "cash", payment_status: "pending_cash" },
    ]);
  });
});
