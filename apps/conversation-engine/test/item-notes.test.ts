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
import { FINISH_HINT_AR } from "@sufria/shared";

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
