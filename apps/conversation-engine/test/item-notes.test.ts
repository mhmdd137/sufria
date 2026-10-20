/**
 * Item notes — brief ن, on a real database: the cart line per (item, note),
 * «أضفت», ن4أ, «سلة», «شيل» (ن-2) · a note in a message of its own (ن-3) ·
 * the summary, «نفسه», the order (ن-4).
 *
 * Every test walks `handleInbound`, and reads the session back through the
 * audit connection, not through the code that wrote it.
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
  FINISH_HINT_AR,
  NOTE_HINT_AR,
  NOTE_TOO_LONG_AR,
  nothingUnderstoodAr,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.NOTES.${RUN}.${label}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96277${String(++customerSeq).padStart(7, "0")}`;

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

/** 1 حمص · 2 شاورما دجاج · 3 فلافل · 4 قهوة بدون سكر. */
const MENU = [
  { name: "حمص", price: "2.50" },
  { name: "شاورما دجاج", price: "3.50" },
  { name: "فلافل", price: "1.00" },
  { name: "قهوة بدون سكر", price: "1.50" },
];

type CartRow = {
  item_id: string;
  name: string;
  unit_price_minor: number;
  qty: number;
  note?: string | null;
};

interface Shop {
  restaurantId: string;
  from: string;
  ids: Record<string, string>;
  say: (body: string | null) => Promise<string>;
  /** As a new customer of the same restaurant would. */
  sayAs: (from: string, body: string | null) => Promise<string>;
  last: () => string | undefined;
  context: () => Promise<Record<string, unknown>>;
  cart: () => Promise<[string, number, string | null][]>;
}

async function shop(label: string): Promise<Shop> {
  const pid = phoneId(label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours, contact_phone)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb, '0790000123') RETURNING id`,
    [`مطعم ${RUN}`, pid],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);
  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'الكل') RETURNING id`,
    [restaurantId],
  );
  const ids: Record<string, string> = {};
  for (const [i, item] of MENU.entries()) {
    const r = await audit.query<{ id: string }>(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [restaurantId, cat.rows[0]?.id, item.name, item.price, i],
    );
    ids[item.name] = r.rows[0]?.id ?? "";
  }

  const sayAs = async (from: string, body: string | null): Promise<string> => {
    const deferred: DeferredSend[] = [];
    const outcome = await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
        body,
        deferred,
        messageType: body === null ? "image" : "text",
        relayed: { orderId: null },
      }),
    );
    await flushDeferred(conversation.sender, deferred);
    return outcome;
  };

  const from = nextCustomer();
  const context = async (): Promise<Record<string, unknown>> => {
    const { rows: ctx } = await audit.query<{
      context: Record<string, unknown>;
    }>(
      `SELECT s.context FROM conversation_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.restaurant_id = $1 AND c.phone_number = $2
        ORDER BY s.created_at DESC LIMIT 1`,
      [restaurantId, from],
    );
    return ctx[0]?.context ?? {};
  };
  const nameOf = (id: string): string =>
    Object.entries(ids).find(([, v]) => v === id)?.[0] ?? id;

  expect(await sayAs(from, "مرحبا")).toBe("greeted");
  replies.reset();

  return {
    restaurantId,
    from,
    ids,
    say: (body) => sayAs(from, body),
    sayAs,
    last: () => replies.forRestaurant(restaurantId).at(-1)?.body,
    context,
    cart: async () =>
      (((await context())["cart"] as CartRow[] | undefined) ?? []).map((l) => [
        nameOf(l.item_id),
        l.qty,
        l.note ?? null,
      ]),
  };
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود");
  audit = new Pool({ connectionString: url, max: 2 });
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
  if (createdRestaurants.length > 0) {
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

const LONG_NOTE = "ب".repeat(101);

// ===========================================================================
describe("ن-2 · the cart line per (item, note)", () => {
  it("ن2 letter for letter: «2 بدون بصل» → the multiple form, ن1 under it", async () => {
    const s = await shop("n2");
    await s.say("2 بدون بصل");
    expect(s.last()).toBe(
      [
        "أضفت:",
        "شاورما دجاج ×1",
        "ملاحظة: بدون بصل",
        "المجموع 3.50 د.أ",
        FINISH_HINT_AR,
      ].join("\n"),
    );
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل"]]);
  });

  it("«2» then «2 بدون بصل» = two lines", async () => {
    const s = await shop("two-lines");
    await s.say("2");
    await s.say("2 بدون بصل");
    expect(await s.cart()).toEqual([
      ["شاورما دجاج", 1, null],
      ["شاورما دجاج", 1, "بدون بصل"],
    ]);
  });

  it("«2 بدون بصل» twice = one line ×2, the first text kept", async () => {
    const s = await shop("same-note");
    await s.say("2 بدون بصل");
    await s.say("2 بدون بصل!");
    expect(await s.cart()).toEqual([["شاورما دجاج", 2, "بدون بصل"]]);
    expect(s.last()).toBe(
      ["أضفت:", "شاورما دجاج ×1", "ملاحظة: بدون بصل", "المجموع 7 د.أ"].join(
        "\n",
      ),
    );
  });

  it("with no note, «أضفت» exactly as before", async () => {
    const s = await shop("no-note");
    await s.say("1");
    expect(s.last()).toBe(`أضفت: حمص ×1 — المجموع 2.50 د.أ\n${FINISH_HINT_AR}`);
  });

  it("the item's name is not a note: «2 شاورما» none · «2 شاورما بدون بصل» «بدون بصل»", async () => {
    const s = await shop("name-off");
    await s.say("2 شاورما");
    await s.say("2 شاورما بدون بصل");
    expect(await s.cart()).toEqual([
      ["شاورما دجاج", 1, null],
      ["شاورما دجاج", 1, "بدون بصل"],
    ]);
    // «قهوة بدون سكر» · «4 قهوة بدون هيل» keeps «بدون هيل» (§2.3 🔴).
    await s.say("4 قهوة بدون هيل");
    expect((await s.cart()).at(-1)).toEqual(["قهوة بدون سكر", 1, "بدون هيل"]);
  });

  it("the cap is on the whole item: every line in the cart and the message", async () => {
    const s = await shop("cap");
    await s.say("2 ×30");
    await s.say("2 ×30 بدون بصل");
    expect(s.last()).toBe("الكمية 60 أكثر من الحد. الأقصى 50 للصنف الواحد.");
    expect(await s.cart()).toEqual([["شاورما دجاج", 30, null]]);
    await s.say("2 ×20 بدون بصل");
    expect(await s.cart()).toEqual([
      ["شاورما دجاج", 30, null],
      ["شاورما دجاج", 20, "بدون بصل"],
    ]);
  });

  it("ن4أ: a note over 100 → the item is not added; the message's others are", async () => {
    const s = await shop("too-long");
    await s.say(`2 ${LONG_NOTE} 1`);
    expect(s.last()).toBe(
      [
        "أضفت: حمص ×1 — المجموع 2.50 د.أ",
        "الصنف شاورما دجاج لم يُضف: ملاحظته أطول من 100 حرف. اكتب رقمه وملاحظة أقصر.",
        FINISH_HINT_AR,
      ].join("\n"),
    );
    expect(await s.cart()).toEqual([["حمص", 1, null]]);
    // 100 exactly is a note.
    await s.say(`2 ${"ب".repeat(100)}`);
    expect((await s.cart()).at(-1)).toEqual([
      "شاورما دجاج",
      1,
      "ب".repeat(100),
    ]);
  });

  it("«سلة»: ن1 under each line with a note", async () => {
    const s = await shop("cart-view");
    await s.say("2 بدون بصل 2 1");
    await s.say("سلة");
    expect(s.last()).toBe(
      [
        "سلّتك:",
        "2 · شاورما دجاج ×1 — 3.50 د.أ",
        "ملاحظة: بدون بصل",
        "2 · شاورما دجاج ×1 — 3.50 د.أ",
        "1 · حمص ×1 — 2.50 د.أ",
        "المجموع 9.50 د.أ",
        "لحذف صنف: «شيل» ورقمه",
      ].join("\n"),
    );
  });

  it("«شيل 2» takes every line of item 2", async () => {
    const s = await shop("remove");
    await s.say("2 بدون بصل 2 1");
    await s.say("شيل 2");
    expect(await s.cart()).toEqual([["حمص", 1, null]]);
  });

  it("an item off: named once, whatever its lines — at the add and at «منيو»", async () => {
    const s = await shop("unavailable");
    await s.say("2 بدون بصل 2");
    await audit.query(
      "UPDATE menu_items SET is_available = false WHERE id = $1",
      [s.ids["شاورما دجاج"]],
    );
    await s.say("2 زيادة صوص 2");
    expect(s.last()).toBe("الصنف شاورما دجاج غير متوفر الآن.");
    await s.say("منيو");
    expect(s.last()).toBe("الصنف شاورما دجاج لم يعد متوفرا وحُذف من سلّتك.");
    expect(await s.cart()).toEqual([]);
  });

  it("a session written before brief ن (no `note`) reads, and its line takes «1»", async () => {
    const s = await shop("old-session");
    await s.say("1");
    await audit.query(
      `UPDATE conversation_sessions s
          SET context = jsonb_set(context, '{cart}',
                (SELECT jsonb_agg(l - 'note') FROM jsonb_array_elements(context->'cart') l))
                        - 'last_added' - 'note_hint_sent'
         FROM customers c
        WHERE c.id = s.customer_id AND s.restaurant_id = $1 AND c.phone_number = $2`,
      [s.restaurantId, s.from],
    );
    const before = (await s.context())["cart"] as CartRow[];
    expect(before[0]).not.toHaveProperty("note");
    await s.say("1");
    expect(await s.cart()).toEqual([["حمص", 2, null]]);
  });
});

// ===========================================================================
describe("ن-3 · a note in a message of its own", () => {
  const NOTHING = nothingUnderstoodAr(MENU.length);

  it("«2» ← «بدون بصل»: 2 ×1 «بدون بصل», ن3", async () => {
    const s = await shop("alone");
    await s.say("2");
    await s.say("بدون بصل");
    expect(s.last()).toBe("أضفت الملاحظة:\nشاورما دجاج ×1\nملاحظة: بدون بصل");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل"]]);
    expect((await s.context())["unparsed_streak"]).toBe(0);
  });

  it("«2» ← «تمام»: no note, today's reply, no ن5", async () => {
    const s = await shop("reply-word");
    await s.say("2");
    await s.say("تمام");
    expect(s.last()).toBe(NOTHING);
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, null]]);
  });

  it("«2» ← «👍»: no note", async () => {
    const s = await shop("emoji");
    await s.say("2");
    await s.say("👍");
    expect(s.last()).toBe(NOTHING);
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, null]]);
  });

  it("«2 5» ← «بدون بصل»: no note (two lines), ن5", async () => {
    const s = await shop("two-added");
    await s.say("2 3");
    await s.say("بدون بصل");
    expect(s.last()).toBe(`${NOTHING}\n${NOTE_HINT_AR}`);
    expect(await s.cart()).toEqual([
      ["شاورما دجاج", 1, null],
      ["فلافل", 1, null],
    ]);
  });

  it("«2» onto a line already ×1 (now ×2) ← «بدون بصل»: 1 without + 1 with", async () => {
    const s = await shop("merged");
    await s.say("2");
    await s.say("2");
    await s.say("بدون بصل");
    expect(await s.cart()).toEqual([
      ["شاورما دجاج", 1, null],
      ["شاورما دجاج", 1, "بدون بصل"],
    ]);
    expect(s.last()).toBe("أضفت الملاحظة:\nشاورما دجاج ×1\nملاحظة: بدون بصل");
  });

  it("the moved pieces keep the line's price, not today's", async () => {
    const s = await shop("price");
    await s.say("2 ×2");
    await audit.query("UPDATE menu_items SET price = 9.00 WHERE id = $1", [
      s.ids["شاورما دجاج"],
    ]);
    await s.say("2");
    await s.say("بدون بصل");
    const cart = (await s.context())["cart"] as CartRow[];
    // ×2 at 3.50 then ×1 at 3.50 on the same line: the note's line is 3.50.
    expect(
      cart.map((l) => [l.qty, l.unit_price_minor, l.note ?? null]),
    ).toEqual([
      [2, 350, null],
      [1, 350, "بدون بصل"],
    ]);
  });

  it("«2 بدون بصل» ← «زيادة صوص»: «بدون بصل، زيادة صوص»", async () => {
    const s = await shop("join");
    await s.say("2 بدون بصل");
    await s.say("زيادة صوص");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل، زيادة صوص"]]);
  });

  it("«2» ← «بدون بصل» ← «زيادة صوص»: «بدون بصل، زيادة صوص»", async () => {
    const s = await shop("twice");
    await s.say("2");
    await s.say("بدون بصل");
    await s.say("زيادة صوص");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل، زيادة صوص"]]);
    expect(s.last()).toBe(
      "أضفت الملاحظة:\nشاورما دجاج ×1\nملاحظة: بدون بصل، زيادة صوص",
    );
  });

  it("«2» ← «سلة» ← «بدون بصل»: no note («سلة» emptied it), ن5", async () => {
    const s = await shop("cleared");
    await s.say("2");
    await s.say("سلة");
    await s.say("بدون بصل");
    expect(s.last()).toBe(`${NOTHING}\n${NOTE_HINT_AR}`);
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, null]]);
  });

  it("«2» ← «شاورما بدون بصل» (2 = شاورما دجاج): «بدون بصل», the name off", async () => {
    const s = await shop("alone-name");
    await s.say("2");
    await s.say("شاورما بدون بصل");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل"]]);
  });

  it("«2» ← 101 characters: ن4ب, the line without a note — and a shorter one then sticks", async () => {
    const s = await shop("alone-long");
    await s.say("2");
    await s.say(LONG_NOTE);
    expect(s.last()).toBe(NOTE_TOO_LONG_AR);
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, null]]);
    await s.say("بدون بصل");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "بدون بصل"]]);
  });

  it("joined over 100: ن4ب, the old note stays", async () => {
    const s = await shop("join-long");
    await s.say(`2 ${"ب".repeat(90)}`);
    await s.say("زيادة صوص كتير");
    expect(s.last()).toBe(NOTE_TOO_LONG_AR);
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, "ب".repeat(90)]]);
  });

  it("«بدون بصل» on an empty cart: today's reply, no ن5", async () => {
    const s = await shop("empty");
    await s.say("بدون بصل");
    expect(s.last()).toBe(NOTHING);
  });

  it("ن5 once in a session", async () => {
    const s = await shop("hint-once");
    await s.say("2 3");
    await s.say("بدون بصل");
    expect(s.last()).toBe(`${NOTHING}\n${NOTE_HINT_AR}`);
    await s.say("بدون ثوم");
    expect(s.last()).toBe(NOTHING);
  });

  it("ن5 with «غير واضح»: text before the first number, before «تم»'s hint", async () => {
    const s = await shop("hint-unclear");
    await s.say("بدون بصل 2");
    expect(s.last()).toBe(
      [
        "أضفت: شاورما دجاج ×1 — المجموع 3.50 د.أ",
        "الجزء «بدون بصل» غير واضح — الطلب بالأرقام فقط.",
        NOTE_HINT_AR,
        FINISH_HINT_AR,
      ].join("\n"),
    );
  });

  it("an order command is no note: «اكد» after «2» leaves the line as it was", async () => {
    const s = await shop("command");
    await s.say("2");
    await s.say("اكد");
    expect(await s.cart()).toEqual([["شاورما دجاج", 1, null]]);
  });
});

// ===========================================================================
describe("ن-4 · the summary, «أكّد», «آخر طلب لك» and «نفسه»", () => {
  const SUMMARY_TAIL = [
    "الاستلام من المطعم",
    "الدفع نقدا.",
    "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
  ];

  it("the summary: ن1 under each line with a note; «أكّد» writes order_items.notes", async () => {
    const s = await shop("summary");
    await s.say("2 بدون بصل 2 1");
    await s.say("تم");
    expect(s.last()).toBe(
      [
        "ملخّص طلبك:",
        "2 · شاورما دجاج ×1 — 3.50 د.أ",
        "ملاحظة: بدون بصل",
        "2 · شاورما دجاج ×1 — 3.50 د.أ",
        "1 · حمص ×1 — 2.50 د.أ",
        "المجموع 9.50 د.أ",
        ...SUMMARY_TAIL,
      ].join("\n"),
    );
    await s.say("اكد");
    const { rows } = await audit.query<{
      name: string;
      quantity: number;
      notes: string | null;
    }>(
      `SELECT oi.item_name_snapshot AS name, oi.quantity, oi.notes
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.restaurant_id = $1
        ORDER BY oi.item_name_snapshot, oi.notes NULLS FIRST`,
      [s.restaurantId],
    );
    expect(rows).toEqual([
      { name: "حمص", quantity: 1, notes: null },
      { name: "شاورما دجاج", quantity: 1, notes: null },
      { name: "شاورما دجاج", quantity: 1, notes: "بدون بصل" },
    ]);
  });

  /** A finished order 5 hours old, its lines as given, for a new customer. */
  async function pastOrder(
    s: Shop,
    from: string,
    lines: { item: string; qty: number; note: string | null }[],
  ): Promise<void> {
    const customer = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
      [s.restaurantId, from],
    );
    const order = await audit.query<{ id: string }>(
      `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                           payment_method, status, payment_status, notified,
                           subtotal, total, created_at, updated_at)
       VALUES ($1, $2, 900, 'pickup', 'cash', 'completed', 'collected', true,
               10.00, 10.00, now() - interval '5 hours', now() - interval '5 hours')
       RETURNING id`,
      [s.restaurantId, customer.rows[0]?.id],
    );
    for (const line of lines) {
      await audit.query(
        `INSERT INTO order_items (order_id, restaurant_id, menu_item_id,
                                  item_name_snapshot, unit_price_snapshot, quantity, notes)
         VALUES ($1, $2, $3, $4, 1.00, $5, $6)`,
        [
          order.rows[0]?.id,
          s.restaurantId,
          s.ids[line.item],
          line.item,
          line.qty,
          line.note,
        ],
      );
    }
  }

  it("«آخر طلب لك» shows ن1; «نفسه» copies the notes, line by line, to the summary", async () => {
    const s = await shop("reorder");
    const from = nextCustomer();
    await pastOrder(s, from, [
      { item: "شاورما دجاج", qty: 2, note: "بدون بصل" },
      { item: "شاورما دجاج", qty: 1, note: null },
      { item: "حمص", qty: 1, note: null },
    ]);
    await s.sayAs(from, "مرحبا");
    const first = replies.forRestaurant(s.restaurantId).at(-1)?.body ?? "";
    expect(first).toContain(
      [
        "آخر طلب لك:",
        "حمص ×1 — 2.50 د.أ",
        "شاورما دجاج ×1 — 3.50 د.أ",
        "شاورما دجاج ×2 — 7 د.أ",
        "ملاحظة: بدون بصل",
        "المجموع 13 د.أ",
        "اكتب «نفسه» لتكرار الطلب.",
      ].join("\n"),
    );

    await s.sayAs(from, "نفسه");
    expect(replies.forRestaurant(s.restaurantId).at(-1)?.body).toBe(
      [
        "ملخّص طلبك:",
        "1 · حمص ×1 — 2.50 د.أ",
        "2 · شاورما دجاج ×1 — 3.50 د.أ",
        "2 · شاورما دجاج ×2 — 7 د.أ",
        "ملاحظة: بدون بصل",
        "المجموع 13 د.أ",
        ...SUMMARY_TAIL,
      ].join("\n"),
    );
  });

  it("an order from before brief ن (no notes): the block as today", async () => {
    const s = await shop("reorder-old");
    const from = nextCustomer();
    await pastOrder(s, from, [
      { item: "شاورما دجاج", qty: 1, note: null },
      { item: "شاورما دجاج", qty: 1, note: null },
    ]);
    await s.sayAs(from, "مرحبا");
    const first = replies.forRestaurant(s.restaurantId).at(-1)?.body ?? "";
    expect(first).toContain(
      "آخر طلب لك:\nشاورما دجاج ×2 — 7 د.أ\nالمجموع 7 د.أ\n",
    );
    expect(first).not.toContain("ملاحظة:");
  });
});
