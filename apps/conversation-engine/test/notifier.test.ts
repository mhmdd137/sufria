/**
 * و-2 · مُراقِب الإشعارات (FR-11) — على قاعدة حقيقية، بالمرسِل الوهمي.
 *
 * المواصفة: بريف و §1.1 إلى §1.5 و§4. كل اختبار بيبني مطعمه وطلباته باتصال
 * تدقيق فوق RLS (`MIGRATION_DATABASE_URL`)، وبيقرأ النتيجة منه — مش من نفس
 * الكود اللي كتبها.
 *
 * 🔴 كل مُراقِب هون محصور بمطاعم الاختبار (`restaurantScope`)، وكل عدّ بيعدّ
 *    صفوف طلب أو مطعم أنشأه الاختبار نفسه: سويت الـAPI بتشتغل بالتوازي تحت
 *    `pnpm -r test` وبتغيّر حالات طلباتها وبتفحص `notified` عليها.
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
import type { OrderStatus } from "@sufria/shared";

import { TenantDb } from "../src/db/tenant-db.js";
import {
  OrderNotifier,
  type NotifierLog,
  type OrderNotifierOptions,
} from "../src/notify/order-notifier.js";
import {
  RecordingWhatsAppSender,
  WhatsAppSendError,
  type OutboundTextMessage,
  type WhatsAppSender,
} from "../src/whatsapp/sender.js";

const RUN = randomUUID();

let db: TenantDb;
let audit: Pool;
let sender: RecordingWhatsAppSender;
const createdRestaurants: string[] = [];

let phoneSeq = 0;
const nextPhone = (): string => `96277${String(++phoneSeq).padStart(7, "0")}`;

interface Shop {
  id: string;
  phoneNumberId: string;
}

/**
 * A restaurant; `transfer` makes it a transfer restaurant with these details
 * (brief م-هـ-أ), in `currency` (the database's default, JOD, otherwise).
 */
async function shop(
  label: string,
  opts: { transfer?: string; currency?: "JOD" | "ILS" } = {},
): Promise<Shop> {
  const phoneNumberId = `PHONE.NOTIFY.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              payment_method, transfer_details, currency)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb,
             $3::payment_method, $4, $5)
     RETURNING id`,
    [
      `مطعم إشعارات ${label} ${RUN}`,
      phoneNumberId,
      opts.transfer === undefined ? "cash" : "transfer",
      opts.transfer ?? null,
      opts.currency ?? "JOD",
    ],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);
  return { id, phoneNumberId };
}

interface Order {
  id: string;
  /** رقم الزبون — كل طلب بزبون لحاله. */
  to: string;
  /** `orders.order_number` — in every status message since brief م-أ. */
  number: number;
}

let orderNumber = 101;

/**
 * طلب بحالة معيّنة، مشكّل على كل قيود `orders`، بـ`notified = false` —
 * يعني زي ما بيتركه الـAPI بعد تغيير حالة.
 *
 * `acceptedNoticed` (brief م-هـ-أ): its accepted message was sent before.
 * By default as 0021's backfill fills it — an order past `accepted`, or
 * accepted and already notified, has it — so an order built `preparing` is
 * one whose «أكّدنا» went out a cycle earlier, as before 0021.
 */
async function order(
  s: Shop,
  spec: {
    status: OrderStatus;
    fulfillment?: "pickup" | "delivery";
    reason?: string | null;
    notified?: boolean;
    /** بالساعات قبل الآن. */
    ageHours?: number;
    acceptedNoticed?: boolean;
    /** `transfer` / `pending_transfer` (collected once completed). */
    transfer?: boolean;
  },
): Promise<Order> {
  const to = nextPhone();
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [s.id, to],
  );
  const fulfillment = spec.fulfillment ?? "pickup";
  const fee = fulfillment === "delivery" ? "1.50" : "0";
  const number = orderNumber++;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         cancellation_reason, notified, subtotal, delivery_fee,
                         total, delivery_address, ready_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::fulfillment_type, $10::payment_method, $5::order_status,
             CASE WHEN $5 = 'completed' THEN 'collected'
                  WHEN $10 = 'transfer' THEN 'pending_transfer'
                  ELSE 'pending_cash' END::payment_status,
             CASE WHEN $5 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             $6, $7, 5.00, $8::numeric, 5.00 + $8::numeric,
             CASE WHEN $4 = 'delivery' THEN 'شارع الجامعة، بناية 12' END,
             CASE WHEN $5 IN ('ready', 'completed') THEN now() END,
             now() - make_interval(hours => $9), now() - interval '1 hour')
     RETURNING id`,
    [
      s.id,
      customer.rows[0]?.id,
      number,
      fulfillment,
      spec.status,
      spec.reason ?? null,
      spec.notified ?? false,
      fee,
      spec.ageHours ?? 0,
      spec.transfer ? "transfer" : "cash",
    ],
  );
  const id = rows[0]?.id ?? "";
  const noticed =
    spec.acceptedNoticed ??
    (["preparing", "ready", "completed", "expired"].includes(spec.status) ||
      (spec.status === "accepted" && (spec.notified ?? false)));
  if (noticed)
    await audit.query(
      `UPDATE orders SET accepted_notice_at = now() - interval '1 hour' WHERE id = $1`,
      [id],
    );
  return { id, to, number };
}

/** نفس ما يفعله `PATCH /orders/:id/status`: الحالة، و`notified = false`. */
async function staffChangesStatus(
  orderId: string,
  to: OrderStatus,
  reason: string | null = null,
): Promise<void> {
  await audit.query(
    `UPDATE orders
        SET status = $2::order_status,
            notified = false,
            updated_at = now(),
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN 'restaurant'::cancelled_by END,
            cancellation_reason = $3,
            ready_at = CASE WHEN $2 = 'ready' THEN now() ELSE ready_at END
      WHERE id = $1`,
    [orderId, to, reason],
  );
}

async function stateOf(orderId: string): Promise<{
  notified: boolean;
  outbound_msg_count: number;
  updated_at: Date;
  accepted_notice_at: Date | null;
}> {
  const { rows } = await audit.query<{
    notified: boolean;
    outbound_msg_count: number;
    updated_at: Date;
    accepted_notice_at: Date | null;
  }>(
    `SELECT notified, outbound_msg_count, updated_at, accepted_notice_at
       FROM orders WHERE id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) throw new Error(`الطلب ${orderId} مش موجود`);
  return row;
}

interface LogLine {
  level: "error" | "warn" | "info" | "debug";
  obj: Record<string, unknown>;
  msg: string;
}

function captureLog(): { lines: LogLine[]; log: NotifierLog } {
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

function notifier(
  shops: Shop[],
  options: OrderNotifierOptions & { via?: WhatsAppSender } = {},
): OrderNotifier {
  const { via, ...rest } = options;
  return new OrderNotifier(db, via ?? sender, {
    sleep: async () => undefined,
    log: captureLog().log,
    ...rest,
    restaurantScope: shops.map((s) => s.id),
  });
}

const sentTo = (to: string): OutboundTextMessage[] =>
  sender.sent.filter((m) => m.to === to);

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  sender = new RecordingWhatsAppSender();
});

afterEach(() => {
  sender.reset();
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

// ---------------------------------------------------------------------------
// جدول الرسائل — §1.1
// ---------------------------------------------------------------------------

describe("جدول الرسائل (§1.1)", () => {
  it("1. accepted ← رسالة واحدة «أكّدنا طلبك رقم …» برقمه، و notified = true، و updated_at ما انلمس", async () => {
    const s = await shop("accepted");
    const o = await order(s, { status: "accepted" });
    const before = await stateOf(o.id);

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    const after = await stateOf(o.id);
    expect(after.notified).toBe(true);
    // 🔴 الإشعار مش تغيير بالطلب (§1.2).
    expect(after.updated_at).toEqual(before.updated_at);
  });

  it("2. 🔴 preparing ← صفر رسائل، و notified = true", async () => {
    const s = await shop("preparing");
    const o = await order(s, { status: "preparing" });

    await notifier([s]).tick();

    expect(sentTo(o.to)).toHaveLength(0);
    expect((await stateOf(o.id)).notified).toBe(true);
  });

  it("3. ready ← استلام «طلبك رقم … جاهز للاستلام.» · توصيل «طلبك رقم … خرج للتوصيل.»", async () => {
    const s = await shop("ready");
    const pickup = await order(s, { status: "ready", fulfillment: "pickup" });
    const delivery = await order(s, {
      status: "ready",
      fulfillment: "delivery",
    });

    await notifier([s]).tick();

    expect(sentTo(pickup.to).map((m) => m.body)).toEqual([
      `طلبك رقم ${pickup.number} جاهز للاستلام.`,
    ]);
    expect(sentTo(delivery.to).map((m) => m.body)).toEqual([
      `طلبك رقم ${delivery.number} خرج للتوصيل.`,
    ]);
  });

  it("4. 🔴 completed ← صفر رسائل، و notified = true", async () => {
    const s = await shop("completed");
    const o = await order(s, { status: "completed" });

    await notifier([s]).tick();

    expect(sentTo(o.to)).toHaveLength(0);
    expect((await stateOf(o.id)).notified).toBe(true);
  });

  it("5. cancelled ← بسبب: النص بالسبب حرفيا · بلا سبب: «ألغينا طلبك رقم ….»", async () => {
    const s = await shop("cancelled");
    const withReason = await order(s, {
      status: "cancelled",
      reason: "نفد الخبز",
    });
    const noReason = await order(s, { status: "cancelled", reason: null });
    const blank = await order(s, { status: "cancelled", reason: "   " });

    await notifier([s]).tick();

    expect(sentTo(withReason.to).map((m) => m.body)).toEqual([
      `ألغينا طلبك رقم ${withReason.number} — نفد الخبز.`,
    ]);
    expect(sentTo(noReason.to).map((m) => m.body)).toEqual([
      `ألغينا طلبك رقم ${noReason.number}.`,
    ]);
    expect(sentTo(blank.to).map((m) => m.body)).toEqual([
      `ألغينا طلبك رقم ${blank.number}.`,
    ]);
  });

  it("6. 🔴 pending_acceptance بـ notified = false ← صفر رسائل، و notified = true", async () => {
    // «استلمنا» بيبعتها المحرّك عند الإنشاء (ج §15.3). رسالة هون = رسالتان.
    const s = await shop("pending");
    const o = await order(s, { status: "pending_acceptance" });

    await notifier([s]).tick();

    expect(sentTo(o.to)).toHaveLength(0);
    expect((await stateOf(o.id)).notified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// الالتقاط الذرّي — §1.2
// ---------------------------------------------------------------------------

describe("الالتقاط الذرّي (§1.2)", () => {
  it("7. 🔴 السباق: الموظف يلغي بين القائمة والالتقاط ← رسالة الإلغاء، ولا «أكّدنا» أبدا", async () => {
    const s = await shop("race");
    const o = await order(s, { status: "accepted" });

    await notifier([s], {
      // بعد ما انقرأت القائمة وقبل الالتقاط — المكان الوحيد للسباق.
      beforeClaim: async (orderId) => {
        if (orderId === o.id)
          await staffChangesStatus(o.id, "cancelled", "نفد الخبز");
      },
    }).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `ألغينا طلبك رقم ${o.number} — نفد الخبز.`,
    ]);
    expect((await stateOf(o.id)).notified).toBe(true);
  });

  it("8. 🔴 دورتان متوازيتان على نفس الطلب ← رسالة واحدة بالضبط", async () => {
    const s = await shop("parallel");
    const o = await order(s, { status: "accepted" });

    // مُراقِبان (عمليتان)، والاتنين بيوقفوا بعد القائمة لحد ما يوصلوا سوا —
    // فالاتنين شافوا الطلب `notified = false` قبل ما حدا يلتقطه. ترتيب مش
    // سباق: `Promise.all` لحالها بتمر أو بتسقط حسب مين خلّص قائمته أول.
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
    const a = notifier([s], { beforeClaim: barrier });
    const b = notifier([s], { beforeClaim: barrier });

    const [ra, rb] = await Promise.all([a.tick(), b.tick()]);

    expect(arrived).toBe(2);
    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    expect(
      [...ra.outcomes, ...rb.outcomes].map((x) => x.outcome).sort(),
    ).toEqual(["already_claimed", "sent"]);
  });

  it("دورتان بنفس العملية ← التانية بتنتجاوز (§1.5)", async () => {
    const s = await shop("overlap");
    const o = await order(s, { status: "accepted" });
    const n = notifier([s]);

    const [first, second] = await Promise.all([n.tick(), n.tick()]);

    expect(first.skipped).toBe(false);
    expect(second).toEqual({ skipped: true, outcomes: [] });
    expect(sentTo(o.to)).toHaveLength(1);
  });

  it("9. تغيير حالة بعد الإشعار (notified يرجع false) ← الدورة الجاية بتبعت الحالة الجديدة", async () => {
    const s = await shop("next");
    const o = await order(s, { status: "accepted" });
    const n = notifier([s]);

    await n.tick();
    await staffChangesStatus(o.id, "ready");
    await n.tick();
    // ودورة تالتة بلا تغيير ما بتبعت إشي.
    await n.tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
      `طلبك رقم ${o.number} جاهز للاستلام.`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// الإرسال — §1.3 و§1.4
// ---------------------------------------------------------------------------

/** بيفشل دايما لرقم واحد، ولغيره بيسجّل زي الوهمي. */
class FailingFor implements WhatsAppSender {
  attempts = 0;
  constructor(
    private readonly failTo: string,
    private readonly inner: WhatsAppSender,
  ) {}
  async sendText(message: OutboundTextMessage): Promise<void> {
    if (message.to === this.failTo) {
      this.attempts += 1;
      throw new WhatsAppSendError("ميتا رفضت الإرسال: 400", 400, 131047);
    }
    await this.inner.sendText(message);
  }
}

describe("الإرسال (§1.3 و§1.4)", () => {
  it("10. 🔴 المرسِل يفشل دائما ← 3 محاولات بالضبط، ثم notified = true، وسطر error، وطلب آخر بنفس الدورة وصلته رسالته", async () => {
    const s = await shop("failing");
    // الفاشل أقدم، فبيجي أول بالدورة — والتاني لازم يوصله رغم هيك.
    const failing = await order(s, { status: "accepted", ageHours: 2 });
    const other = await order(s, { status: "accepted", ageHours: 1 });
    const via = new FailingFor(failing.to, sender);
    const { lines, log } = captureLog();
    const sleeps: number[] = [];

    const result = await notifier([s], {
      via,
      log,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).tick();

    expect(via.attempts).toBe(3);
    expect(sleeps).toEqual([2000, 6000]);
    // 🔴 مرة على الأكثر: الاستسلام ما بيرجّع notified = false.
    expect((await stateOf(failing.id)).notified).toBe(true);
    expect((await stateOf(failing.id)).outbound_msg_count).toBe(0);
    expect(sentTo(other.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${other.number}.`,
    ]);
    expect(result.outcomes).toEqual([
      { orderId: failing.id, outcome: "send_failed" },
      { orderId: other.id, outcome: "sent" },
    ]);

    const errors = lines.filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toMatchObject({
      orderId: failing.id,
      status: "accepted",
      metaCode: 131047,
      attempts: 3,
    });
    // 🔴 رقم الزبون مقنّع: آخر 4 أرقام، ولا سطر فيه الرقم كامل.
    expect(errors[0]?.obj["to"]).toBe(`****${failing.to.slice(-4)}`);
    for (const line of lines)
      expect(JSON.stringify(line.obj)).not.toContain(failing.to);
  });

  it("11. 🔴 طلب أُنشئ قبل 24 ساعة ← صفر رسائل، و notified = true، وسطر warn", async () => {
    const s = await shop("window");
    const o = await order(s, { status: "accepted", ageHours: 24 });
    const { lines, log } = captureLog();

    await notifier([s], { log }).tick();

    expect(sentTo(o.to)).toHaveLength(0);
    expect((await stateOf(o.id)).notified).toBe(true);
    expect(
      lines.filter((l) => l.level === "warn" && l.obj["orderId"] === o.id),
    ).toHaveLength(1);
  });

  it("طلب عمره 23 ساعة ← لسا جوّا النافذة، بيوصله", async () => {
    const s = await shop("window-inside");
    const o = await order(s, { status: "accepted", ageHours: 23 });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
  });

  it("12. 🔴 العزل: طلب مطعم أ يُرسَل من رقم مطعم أ، لا من رقم مطعم ب", async () => {
    const a = await shop("iso-a");
    const b = await shop("iso-b");
    const oa = await order(a, { status: "accepted" });
    const ob = await order(b, { status: "ready" });

    await notifier([a, b]).tick();

    expect(sentTo(oa.to)).toEqual([
      {
        restaurantId: a.id,
        phoneNumberId: a.phoneNumberId,
        to: oa.to,
        body: `أكّدنا طلبك رقم ${oa.number}.`,
        // Brief I (I-4): a status message names its order, for outbound_messages.
        orderId: oa.id,
      },
    ]);
    expect(sentTo(ob.to)).toEqual([
      {
        restaurantId: b.id,
        phoneNumberId: b.phoneNumberId,
        to: ob.to,
        body: `طلبك رقم ${ob.number} جاهز للاستلام.`,
        orderId: ob.id,
      },
    ]);
    expect(
      sender
        .forRestaurant(a.id)
        .every((m) => m.phoneNumberId === a.phoneNumberId),
    ).toBe(true);
  });

  it("13. عدّاد الرسائل الصادرة: +1 عند الإرسال، ولا شيء عند الصمت", async () => {
    const s = await shop("counter");
    const sent = await order(s, { status: "accepted" });
    const silent = await order(s, { status: "preparing" });

    await notifier([s]).tick();

    expect((await stateOf(sent.id)).outbound_msg_count).toBe(1);
    expect((await stateOf(silent.id)).outbound_msg_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// By payment, and the accepted message once — brief م-هـ-أ §6.2
// ---------------------------------------------------------------------------

const DETAILS = "جوال باي 059XXXXXXX (عرض تجريبي)";
const N2 = (number: number, total: string, currency: string): string =>
  [
    `أكّدنا طلبك رقم ${number}.`,
    `حوّل ${total} ${currency} على:`,
    DETAILS,
    "أرسل إشعار التحويل هنا، ونبدأ تحضير طلبك بعد وصوله.",
  ].join("\n");

describe("by payment, and the accepted message once (brief م-هـ-أ §6.2)", () => {
  it("1. cash accepted → «أكّدنا طلبك رقم N.», and accepted_notice_at written by the claim", async () => {
    const s = await shop("mha1");
    const o = await order(s, { status: "accepted" });
    expect((await stateOf(o.id)).accepted_notice_at).toBeNull();

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    expect((await stateOf(o.id)).accepted_notice_at).not.toBeNull();
  });

  it("2. 🔴 cash, «اقبل» and «ابدأ التحضير» in one cycle (preparing, no notice) → «أكّدنا طلبك رقم N.» (decision 8)", async () => {
    const s = await shop("mha2");
    const o = await order(s, { status: "preparing", acceptedNoticed: false });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    expect((await stateOf(o.id)).accepted_notice_at).not.toBeNull();
  });

  it("3. 🔴 cash accepted (a cycle) → preparing (a cycle): «أكّدنا» once, then nothing", async () => {
    const s = await shop("mha3");
    const o = await order(s, { status: "accepted" });
    const n = notifier([s]);

    await n.tick();
    await staffChangesStatus(o.id, "preparing");
    await n.tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    expect((await stateOf(o.id)).notified).toBe(true);
  });

  it("4. transfer accepted → ن2 letter for letter, its total and currency", async () => {
    const s = await shop("mha4", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, { status: "accepted", transfer: true });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      N2(o.number, "5", "شيكل"),
    ]);
  });

  it("5. 🔴 transfer accepted (a cycle) → preparing (a cycle): ن2, then ن3", async () => {
    const s = await shop("mha5", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, { status: "accepted", transfer: true });
    const n = notifier([s]);

    await n.tick();
    await staffChangesStatus(o.id, "preparing");
    await n.tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      N2(o.number, "5", "شيكل"),
      `نحضّر طلبك رقم ${o.number} الآن.`,
    ]);
  });

  it("6. 🔴 transfer, «اقبل» and «ابدأ» in one cycle → ن2, not ن3", async () => {
    const s = await shop("mha6", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, {
      status: "preparing",
      transfer: true,
      acceptedNoticed: false,
    });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      N2(o.number, "5", "شيكل"),
    ]);
  });

  it("7. transfer cancelled from pending_acceptance → the cancellation as today, no details", async () => {
    const s = await shop("mha7", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, {
      status: "cancelled",
      reason: "نفد الخبز",
      transfer: true,
    });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `ألغينا طلبك رقم ${o.number} — نفد الخبز.`,
    ]);
    expect((await stateOf(o.id)).accepted_notice_at).toBeNull();
  });

  it("8. transfer delivery → ن2 with the total, fee included", async () => {
    const s = await shop("mha8", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, {
      status: "accepted",
      fulfillment: "delivery",
      transfer: true,
    });

    await notifier([s]).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      N2(o.number, "6.50", "شيكل"),
    ]);
  });

  it("9. 🔴 transfer, the restaurant back to cash and its details cleared → «أكّدنا طلبك رقم N.», and a warn line without details", async () => {
    const s = await shop("mha9", { transfer: DETAILS, currency: "ILS" });
    const o = await order(s, { status: "accepted", transfer: true });
    await audit.query(
      `UPDATE restaurants SET payment_method = 'cash', transfer_details = NULL WHERE id = $1`,
      [s.id],
    );
    const { lines, log } = captureLog();

    await notifier([s], { log }).tick();

    expect(sentTo(o.to).map((m) => m.body)).toEqual([
      `أكّدنا طلبك رقم ${o.number}.`,
    ]);
    const warned = lines.filter((l) => l.level === "warn");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.obj).toMatchObject({ orderId: o.id });
    expect(JSON.stringify(lines)).not.toContain("059");
  });

  it("10. preparing with its notice from the backfill → silent: no second «أكّدنا»", async () => {
    const s = await shop("mha10");
    const o = await order(s, { status: "preparing", acceptedNoticed: true });

    await notifier([s]).tick();

    expect(sentTo(o.to)).toHaveLength(0);
    expect((await stateOf(o.id)).notified).toBe(true);
  });

  it("🔴 no log line carries the transfer details, whatever the outcome", async () => {
    const s = await shop("mha-log", { transfer: DETAILS, currency: "ILS" });
    const sent = await order(s, { status: "accepted", transfer: true });
    const failing = await order(s, { status: "accepted", transfer: true });
    const { lines, log } = captureLog();

    await notifier([s], {
      log,
      via: new FailingFor(failing.to, sender),
    }).tick();

    expect(sentTo(sent.to)).toHaveLength(1);
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(DETAILS);
  });
});

// ---------------------------------------------------------------------------
// الدورة — §1.5
// ---------------------------------------------------------------------------

describe("الدورة (§1.5)", () => {
  it("حتى 50 طلبا بالدورة، بترتيب created_at — الباقي للدورة الجاية", async () => {
    const s = await shop("batch");
    const oldest = await order(s, { status: "accepted", ageHours: 3 });
    const middle = await order(s, { status: "accepted", ageHours: 2 });
    const newest = await order(s, { status: "accepted", ageHours: 1 });
    const n = notifier([s], { batchSize: 2 });

    const first = await n.tick();
    expect(first.outcomes.map((x) => x.orderId)).toEqual([
      oldest.id,
      middle.id,
    ]);
    expect((await stateOf(newest.id)).notified).toBe(false);

    const second = await n.tick();
    expect(second.outcomes.map((x) => x.orderId)).toEqual([newest.id]);
  });

  it("طلب notified = true ما بينلمس", async () => {
    const s = await shop("done");
    const o = await order(s, { status: "accepted", notified: true });

    const result = await notifier([s]).tick();

    expect(result.outcomes).toEqual([]);
    expect(sentTo(o.to)).toHaveLength(0);
  });
});
