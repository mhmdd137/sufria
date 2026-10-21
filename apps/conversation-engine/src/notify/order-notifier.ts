import { sql } from "drizzle-orm";
import {
  orderNoticeAr,
  type Currency,
  type OrderStatus,
  type PaymentMethod,
} from "@sufria/shared";

import type { TenantDb } from "../db/tenant-db.js";
import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import { WhatsAppSendError, type WhatsAppSender } from "../whatsapp/sender.js";

/**
 * مُراقِب إشعارات الزبون (FR-11) — بريف و، `docs/15-notifications-brief.md`.
 *
 * الـAPI بيغيّر حالة الطلب وبيحط `notified = false` وما بيبعت إشي (د). هون
 * بيلتقط هالطلبات كل `NOTIFY_POLL_MS` وبيبعت للزبون رسالة وحدة حسب الحالة،
 * أو ولا إشي حين يكون الصمت هو القرار (`orderNoticeAr` بـshared).
 *
 * 🔴 **حسب الدفع، والقبول مرة وحدة** (بريف م-هـ-أ، قرارات 4 و7 و8): طلب
 *    التحويل بتوصله تفاصيل التحويل مع القبول (ن2) و«نحضّر طلبك» مع
 *    التحضير (ن3). والالتقاط بيعلّم `accepted_notice_at` لما يلتقط القبول أو
 *    التحضير، وبيرجّع قيمته **قبل** الالتقاط: طلب `preparing` ما انبعتت
 *    رسالة قبوله (اقبل وابدأ بنفس الدورة) بتوصله رسالة القبول بدل الصمت.
 *
 * 🔴 **الالتقاط ذرّي، والرسالة من الصف اللي رجع منه** (§1.2). التعليم
 *    والقراءة `UPDATE … WHERE notified = false RETURNING` واحد. قراءة سابقة
 *    بتبعت «أكّدنا» لطلب انلغى بين القراءة والتعليم — ورسالة الإلغاء ما
 *    بتوصل أبدا، لأن التعليم بلعها.
 *
 * 🔴 **مرة على الأكثر** (§1.3): الالتقاط بينقفل (COMMIT) قبل الإرسال. عملية
 *    بتموت بينهم بتضيّع الرسالة، وهاد مقبول بالبايلوت: رسالة مكرّرة أسوأ من
 *    ضائعة، والطلب ظاهر باللوحة بكل الأحوال. فشل الإرسال ← محاولتان كمان ثم
 *    استسلام، **بلا** إرجاع `notified = false`.
 *
 * الوصول للقاعدة: المُراقِب ما عنده رسالة واردة، فما عنده سياق مستأجر، و
 * `sufria_engine` بلا سياق بيشوف صفر صفوف. `app.restaurants_with_unnotified_orders()`
 * (0012) بترجّع معرّفات مطاعم وبس، وكل قراءة وكتابة بعدها جوّا `runInTenant`.
 */

/** طلبات لكل دورة، بترتيب `created_at, id` (§1.5). */
export const NOTIFY_BATCH_SIZE = 50;

/** المحاولتان الإضافيتان بعد أول فشل (§1.3). */
export const NOTIFY_RETRY_DELAYS_MS: readonly number[] = [2000, 6000];

/**
 * أقصى عمر طلب لسا بيوصله رسالة حرّة: 23 ساعة و50 دقيقة (§1.4).
 *
 * ميتا بترفض الرسالة الحرّة بعد 24 ساعة من آخر رسالة من الزبون. «أكّد» هي
 * لحظة الإنشاء، فآخر رسالة منه ما بتكون أقدم منها أبدا — الحد محافظ وبلا
 * عمود جديد. العشر دقايق هامش لساعة القاعدة وللإعادات.
 */
export const FREE_FORM_WINDOW_MS = (23 * 60 + 50) * 60 * 1000;

/** صف الطلب زي ما رجع من الالتقاط — مصدر الرسالة الوحيد. */
export interface ClaimedOrder {
  id: string;
  restaurantId: string;
  /** `orders.order_number` — in the message since brief م-أ (decision 10). */
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: "pickup" | "delivery";
  cancellationReason: string | null;
  createdAt: Date;
  /** `customers.phone_number` — للإرسال. **مقنّع** بأي سطر سجل. */
  customerPhone: string;
  /** `restaurants.whatsapp_phone_id` — المرسِل. */
  phoneNumberId: string | null;
  /** `orders.payment_method` (brief م-هـ-أ). */
  paymentMethod: PaymentMethod;
  /** `orders.total` as text, the fee in — ن2's amount. */
  total: string;
  /** `restaurants.currency`. */
  currency: Currency;
  /**
   * `restaurants.transfer_details` — ن2's details, as the restaurant wrote
   * them. 🔴 **Never** in a log line: the restaurant's wallet.
   */
  transferDetails: string | null;
  /**
   * The order's accepted message was claimed before this claim:
   * `accepted_notice_at` as it was **before** it (the CTE's, not
   * `RETURNING`'s, which is always the new one).
   */
  acceptedNoticedBefore: boolean;
}

export type NotificationDecision =
  | { kind: "silent" }
  | { kind: "outside_window" }
  | { kind: "send"; body: string };

/**
 * A transfer order whose restaurant has no details any more (it went back to
 * cash and cleared them after the order was placed), at a status whose
 * message would carry them: the cash message goes, and the notifier warns.
 */
export function transferDetailsMissing(order: ClaimedOrder): boolean {
  return (
    order.paymentMethod === "transfer" &&
    order.transferDetails === null &&
    (order.status === "accepted" || order.status === "preparing")
  );
}

/** القرار الصافي: صمت، خارج النافذة، أو نص. الصمت قبل النافذة — ما في تحذير على صمت. */
export function decideNotification(
  order: ClaimedOrder,
  now: Date,
): NotificationDecision {
  const body = orderNoticeAr({
    ...order,
    payment:
      order.paymentMethod === "transfer"
        ? {
            method: "transfer",
            total: order.total,
            currency: order.currency,
            details: order.transferDetails,
          }
        : { method: order.paymentMethod },
  });
  if (body === null) return { kind: "silent" };
  if (now.getTime() - order.createdAt.getTime() > FREE_FORM_WINDOW_MS)
    return { kind: "outside_window" };
  return { kind: "send", body };
}

export type NotificationOutcome =
  | "sent"
  | "silent"
  | "outside_window"
  | "send_failed"
  | "no_sender_number"
  /** صفر صفوف بالالتقاط: حدا التقطه قبلنا. تجاوز صامت. */
  | "already_claimed"
  | "error";

export interface TickResult {
  /** `true` = دورة سابقة لسا شغّالة بنفس العملية، فهاي انتجاوزت (§1.5). */
  skipped: boolean;
  outcomes: { orderId: string; outcome: NotificationOutcome }[];
}

/** اللي المُراقِب بيستعمله من pino. محقون عشان الاختبار يشوف سطر `error`. */
export interface NotifierLog {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface OrderNotifierOptions {
  /** `0` (الافتراضي) = بلا مؤقّت. `main.ts` بيمرّر `NOTIFY_POLL_MS`. */
  pollMs?: number;
  batchSize?: number;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: NotifierLog;
  /**
   * 🔴 **للاختبارات وحدها.** بيحصر الدورة بهالمطاعم.
   *
   *    تحت `pnpm -r test` سويت الـAPI بتشتغل بالتوازي وبتغيّر حالات طلبات
   *    مطاعمها وبتفحص إن `notified` رجعت `false`. دورة بلا حصر كانت بتلتقط
   *    طلباتهم وتعلّمها — سباق بيسقّط سويت تانية حسب التوقيت.
   */
  restaurantScope?: readonly string[];
  /**
   * 🔴 **للاختبارات وحدها.** بيتنادى بين قراءة القائمة والالتقاط، برا أي
   *    معاملة — المكان الوحيد اللي سباق §1.2 بيصير فيه.
   */
  beforeClaim?: (orderId: string) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class OrderNotifier {
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: NotifierLog;
  private readonly scope: ReadonlySet<string> | null;
  private readonly beforeClaim: ((orderId: string) => Promise<void>) | null;

  private timer: NodeJS.Timeout | null = null;
  /** الدورة الشغّالة. وجودها = الدورة الجاية بتنتجاوز، و`stop()` بتستنّاها. */
  private current: Promise<TickResult> | null = null;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: WhatsAppSender,
    options: OrderNotifierOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 0;
    this.batchSize = options.batchSize ?? NOTIFY_BATCH_SIZE;
    this.retryDelaysMs = options.retryDelaysMs ?? NOTIFY_RETRY_DELAYS_MS;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log ?? logger;
    this.scope = options.restaurantScope
      ? new Set(options.restaurantScope)
      : null;
    this.beforeClaim = options.beforeClaim ?? null;
  }

  /** بيشغّل المؤقّت. `pollMs = 0` ← ولا إشي. */
  start(): void {
    if (this.pollMs === 0 || this.timer !== null) return;
    this.timer = setInterval(() => {
      // tick() ما بترمي — بتلقط كل طلب لحاله. هاد للطبقة اللي فوقهم.
      this.tick().catch((error: unknown) => {
        this.log.error({ err: error }, "🔴 دورة الإشعارات فشلت");
      });
    }, this.pollMs);
  }

  /** بيوقف المؤقّت وبيستنّى الدورة الشغّالة، عشان المخزن ما ينسكّر من تحتها. */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.current !== null) await this.current.catch(() => undefined);
  }

  /**
   * دورة وحدة. **ولا دورتان متداخلتان بنفس العملية** (§1.5): لو دورة لسا
   * شغّالة، هاي بترجع `skipped` فورا. بين عمليتين، الحارس هو
   * `AND notified = false` بالالتقاط.
   */
  async tick(): Promise<TickResult> {
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

  private async runCycle(): Promise<TickResult["outcomes"]> {
    const restaurantIds = await this.db.runUnscoped(async (tx) => {
      const res = await tx.execute<{ id: string }>(
        sql`SELECT r AS id FROM app.restaurants_with_unnotified_orders() r`,
      );
      return res.rows.map((row) => row.id);
    });

    // القائمة: معرّفات وتواريخ بس. **ولا حالة** — الرسالة ما بتنبني إلا من
    // صف الالتقاط، فما في قراءة أولى ممكن حدا يبني عليها بالغلط.
    const candidates: { id: string; restaurantId: string; createdAt: Date }[] =
      [];
    for (const restaurantId of restaurantIds) {
      if (this.scope !== null && !this.scope.has(restaurantId)) continue;
      try {
        const rows = await this.db.runInTenant(restaurantId, async (tx) => {
          const res = await tx.execute<{ id: string; created_at: Date }>(sql`
            SELECT id, created_at
              FROM orders
             WHERE notified = false
             ORDER BY created_at, id
             LIMIT ${this.batchSize}`);
          return res.rows;
        });
        for (const row of rows)
          candidates.push({
            id: row.id,
            restaurantId,
            createdAt: new Date(row.created_at),
          });
      } catch (error) {
        // مطعم واحد ما بيوقف الباقي.
        this.log.error(
          { err: error, restaurantId },
          "🔴 قراءة طلبات مطعم للإشعار فشلت",
        );
      }
    }

    candidates.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    const outcomes: TickResult["outcomes"] = [];
    for (const candidate of candidates.slice(0, this.batchSize)) {
      let outcome: NotificationOutcome;
      try {
        outcome = await this.notifyOne(candidate.id, candidate.restaurantId);
      } catch (error) {
        // 🔴 طلب واحد ما بيوقف الدورة (§1.3).
        this.log.error(
          {
            err: error,
            orderId: candidate.id,
            restaurantId: candidate.restaurantId,
          },
          "🔴 إشعار طلب فشل",
        );
        outcome = "error";
      }
      outcomes.push({ orderId: candidate.id, outcome });
    }
    return outcomes;
  }

  private async notifyOne(
    orderId: string,
    restaurantId: string,
  ): Promise<NotificationOutcome> {
    if (this.beforeClaim !== null) await this.beforeClaim(orderId);

    const order = await this.db.runInTenant(restaurantId, (tx) =>
      claimOrderForNotification(tx, orderId),
    );
    if (order === null) return "already_claimed";

    const logFields = {
      orderId: order.id,
      restaurantId: order.restaurantId,
      status: order.status,
      to: maskPhone(order.customerPhone),
    };

    if (transferDetailsMissing(order))
      // logger.ts: never the details — and here there are none.
      this.log.warn(
        logFields,
        "transfer order, its restaurant has no transfer details — the cash message instead",
      );

    const decision = decideNotification(order, this.now());
    if (decision.kind === "silent") {
      this.log.debug(logFields, "حالة صامتة — انعلّم بلا إرسال");
      return "silent";
    }
    if (decision.kind === "outside_window") {
      this.log.warn(
        logFields,
        "طلب أقدم من نافذة الـ24 ساعة — انعلّم بلا إرسال (بلا قوالب بالبايلوت)",
      );
      return "outside_window";
    }
    if (order.phoneNumberId === null) {
      this.log.error(
        logFields,
        "🔴 المطعم بلا whatsapp_phone_id — ما في مرسِل",
      );
      return "no_sender_number";
    }

    // The claim committed before the send, so the order is there for the
    // saving wrapper's own connection: the message carries it (brief I, I-4).
    const sent = await this.sendWithRetry(
      {
        restaurantId: order.restaurantId,
        phoneNumberId: order.phoneNumberId,
        to: order.customerPhone,
        body: decision.body,
        orderId: order.id,
      },
      logFields,
    );
    if (!sent) return "send_failed";

    // عدّاد الرسائل الصادرة (مدخل تسعير الاشتراك). بعد الإرسال الناجح وبس،
    // ومعاملة لحالها: فشلها ما بيرجّع رسالة انبعثت.
    try {
      await this.db.runInTenant(restaurantId, (tx) =>
        tx.execute(sql`
          UPDATE orders
             SET outbound_msg_count = outbound_msg_count + 1
           WHERE id = ${order.id}::uuid`),
      );
    } catch (error) {
      this.log.error(
        { ...logFields, err: error },
        "🔴 الرسالة انبعثت وعدّاد الرسائل الصادرة ما زاد",
      );
    }
    return "sent";
  }

  private async sendWithRetry(
    message: Parameters<WhatsAppSender["sendText"]>[0],
    logFields: object,
  ): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.sender.sendText(message);
        return true;
      } catch (error) {
        const meta =
          error instanceof WhatsAppSendError
            ? { httpStatus: error.status, metaCode: error.metaCode }
            : { httpStatus: null, metaCode: null };
        const delay = this.retryDelaysMs[attempt - 1];
        if (delay === undefined) {
          // 🔴 استسلام. `notified` بتضل `true` — مرة على الأكثر (§1.3).
          this.log.error(
            { ...logFields, ...meta, attempts: attempt, err: error },
            "🔴 إشعار الزبون ما انبعث بعد كل المحاولات — استسلام",
          );
          return false;
        }
        this.log.warn(
          { ...logFields, ...meta, attempt, retryInMs: delay },
          "إرسال إشعار فشل — إعادة محاولة",
        );
        await this.sleep(delay);
      }
    }
  }
}

/**
 * 🔴 الالتقاط (§1.2): التعليم والقراءة استعلام واحد.
 *
 * - `AND notified = false` هو الحارس بين دورتين متوازيتين: التانية بتلاقي
 *   صفر صفوف. بلاه الاتنين بيبعتوا. الـCTE بتقفل الصف (`FOR UPDATE`)،
 *   فالتانية بتستنّى، وبعدها ما بتلاقي إشي.
 * - 🔴 **`accepted_notice_at` بيتعلّم بالالتقاط، مش بعد الإرسال** (بريف
 *   م-هـ-أ §6.1): نفس «مرة على الأكثر». والقيمة **القديمة** من الـCTE —
 *   `RETURNING` بيرجّع الجديدة، فبتطلع دايما «انبعتت».
 * - الرسالة بتنبني من `RETURNING` — الحالة **بعد** آخر تغيير من الموظف، مش
 *   الحالة اللي كانت وقت القائمة.
 * - `updated_at` ما بينلمس: الإشعار مش تغيير بالطلب.
 *
 * جوّا `runInTenant`، فالـRLS بيحصره بمطعم السياق.
 */
export async function claimOrderForNotification(
  tx: TenantTx,
  orderId: string,
): Promise<ClaimedOrder | null> {
  const res = await tx.execute<{
    id: string;
    restaurant_id: string;
    order_number: number;
    status: OrderStatus;
    fulfillment_type: "pickup" | "delivery";
    cancellation_reason: string | null;
    created_at: Date;
    phone_number: string;
    whatsapp_phone_id: string | null;
    payment_method: PaymentMethod;
    total: string;
    currency: Currency;
    transfer_details: string | null;
    accepted_noticed_before: boolean;
  }>(sql`
    WITH target AS (
      SELECT id, accepted_notice_at AS notice_before
        FROM orders
       WHERE id = ${orderId}::uuid AND notified = false
       FOR UPDATE
    )
    UPDATE orders o
       SET notified = true,
           accepted_notice_at = CASE WHEN o.status IN ('accepted', 'preparing')
                                     THEN COALESCE(o.accepted_notice_at, now())
                                     ELSE o.accepted_notice_at END
      FROM target t, customers c, restaurants r
     WHERE o.id = t.id
       AND c.id = o.customer_id
       AND r.id = o.restaurant_id
    RETURNING o.id, o.restaurant_id, o.order_number, o.status::text AS status,
              o.fulfillment_type::text AS fulfillment_type,
              o.cancellation_reason, o.created_at,
              c.phone_number, r.whatsapp_phone_id,
              o.payment_method::text AS payment_method, o.total::text AS total,
              r.currency, r.transfer_details,
              (t.notice_before IS NOT NULL) AS accepted_noticed_before`);
  const row = res.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    orderNumber: row.order_number,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    cancellationReason: row.cancellation_reason,
    createdAt: new Date(row.created_at),
    customerPhone: row.phone_number,
    phoneNumberId: row.whatsapp_phone_id,
    paymentMethod: row.payment_method,
    total: row.total,
    currency: row.currency,
    transferDetails: row.transfer_details,
    acceptedNoticedBefore: row.accepted_noticed_before,
  };
}
