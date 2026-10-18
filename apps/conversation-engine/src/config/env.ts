import { z } from "zod";

/**
 * الإعدادات بتتفحص عند الإقلاع — مش عند أول webhook.
 *
 * الفرق مش شكلي: لو WHATSAPP_APP_SECRET ناقص وما فحصناه هون، السيرفر بيقلع
 * وبيستقبل طلبات، وكل تحقق توقيع بيفشل — يعني كل رسالة زبون بترجع 401 وميتا
 * بتخفّض تقييم الرقم. الانفجار عند الإقلاع أرخص بكتير.
 */
const EnvSchema = z
  .object({
    // 🔴 sufria_engine — مش postgres. دور superuser بيلغي RLS بصمت،
    //    و tenant-db.ts بيرفض يقلع لو صار (نفس فحص الداشبورد).
    ENGINE_DATABASE_URL: z
      .string()
      .min(1, "ENGINE_DATABASE_URL مفقود — انسخ .env.example لـ.env"),

    // النص اللي بتحطه بإعدادات الـwebhook عند ميتا. بينقارن مع hub.verify_token.
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
      .string()
      .min(
        1,
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN مفقود — بلاه ما في اشتراك webhook",
      ),

    // من إعدادات التطبيق عند ميتا. مفتاح HMAC لتوقيع X-Hub-Signature-256.
    WHATSAPP_APP_SECRET: z
      .string()
      .min(1, "WHATSAPP_APP_SECRET مفقود — بلاه ما في تحقق توقيع"),

    // 🔴 توكن Meta Cloud API للإرسال الصادر. مطلوب عند الإقلاع لنفس سبب
    //    WHATSAPP_APP_SECRET فوق: بلاه المحرّك بيقلع وبيستقبل وبيخزّن تمام،
    //    وكل رد بيطلع للزبون بيفشل — والعطل ما بيبان إلا بسطر log، بعد ما يكون
    //    أول زبون بعت رسالة وما وصله إشي. الانفجار عند الإقلاع أرخص.
    WHATSAPP_ACCESS_TOKEN: z
      .string()
      .min(1, "WHATSAPP_ACCESS_TOKEN مفقود — بلاه ما في إرسال صادر"),

    /** نسخة Graph API. مفصولة عن الرابط عشان الترقية تصير بمتغيّر بيئة مش بنشر. */
    WHATSAPP_GRAPH_API_VERSION: z.string().min(1).default("v21.0"),
    WHATSAPP_GRAPH_API_BASE: z
      .string()
      .url()
      .default("https://graph.facebook.com"),

    /**
     * مهلة طلب الإرسال لميتا. نفس منطق مهلات مخزن الاتصالات تحت: بلاها الطلب
     * بيعلّق للأبد جوّا معاملة قاعدة بيانات مفتوحة، وبيقفل اتصال المخزن معه.
     */
    WHATSAPP_SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    /**
     * دورة مُراقِب الإشعارات (FR-11، بريف و §1.5). `0` يطفئه — والاختبارات
     * بتطفيه وبتنادي `tick()` مباشرة.
     */
    NOTIFY_POLL_MS: z.coerce.number().int().nonnegative().default(5000),

    /**
     * The staff-reply queue's cycle (brief م-ج §6): the engine sends the texts
     * staff write on the dashboard. `0` turns it off — and the tests do, and
     * call `tick()` themselves. Every second by default (brief م-د-9,
     * decision 1): one query a second whatever the number of restaurants,
     * on the queue's partial index (`idx_staff_messages_queue`).
     */
    STAFF_REPLY_POLL_MS: z.coerce.number().int().nonnegative().default(1000),
    /**
     * Decision 9: a staff message that waited longer than this many seconds
     * before its send began is never sent — «your order in 10 minutes»
     * forty minutes late must not go out — and a `sending` one this long
     * after its claim (the process died mid-send) is failed too. Checked
     * against the longest send below, at startup.
     */
    STAFF_REPLY_MAX_WAIT_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(120),

    /**
     * مهلة الجلسة (بريف ح §2): جلسة سكتت هالعدد من الدقائق أو أكتر بتنتهي عند
     * أول رسالة بعدها، والزبون بيبلّش من الترحيب. موجب بس — `0` كان معناه إن
     * كل رسالة بتنهي الجلسة اللي قبلها، فما في محادثة أصلا.
     */
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),

    /**
     * «آخر طلب لك» (brief ك, decision 3): no suggestion while the customer has
     * an order, not cancelled or expired, younger than this many minutes — one
     * still on its way. A variable, not a constant, so the laptop trial can
     * set `1` instead of waiting three hours. Measured on the database's clock.
     */
    REORDER_MIN_AGE_MINUTES: z.coerce.number().int().positive().default(180),

    /**
     * A customer's message after an order (brief م-أ, decision 1) goes to the
     * restaurant while they have an order on its way younger than this many
     * minutes — forgotten orders are real, and with no limit «مرحبا» the next
     * day would answer about an old one…
     */
    RELAY_OPEN_ORDER_MAX_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(180),
    /** …or one completed or cancelled less than this many minutes ago… */
    RELAY_CLOSED_ORDER_MINUTES: z.coerce.number().int().positive().default(60),
    /**
     * …and the relay line is not sent again to the same customer within this
     * many minutes (decision 4): every extra message brings the number closer
     * to a block. Variables, not constants, so the laptop trial can use minutes
     * instead of hours. Measured on the database's clock.
     */
    RELAY_REPLY_QUIET_MINUTES: z.coerce.number().int().positive().default(10),

    ENGINE_PORT: z.coerce.number().int().positive().default(3001),
    PG_POOL_MAX: z.coerce.number().int().positive().default(10),

    // 🔴 مهلات مخزن الاتصالات. الافتراضي عند pg بكل وحدة منهم هو **انتظار
    //    أبدي**، وهاد مش تحفّظ — هو أسوأ سلوك ممكن هون. مخزن مشبّع أو قاعدة
    //    ما بترد بيعلّقوا معالج الـwebhook للأبد، وميتا بتقطع الطلب من طرفها
    //    بلا رد، والمعالجات المعلّقة بتتكدّس لحد ما تموت العملية بلا سبب باين.
    //    مهلة بتخلّي الفشل صريح وسريع، والرد بيصير 500 وميتا بتعيد الإرسال.

    /** انتظار اتصال حر من المخزن (أو فتح اتصال جديد). */
    PG_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    /** Postgres بيلغي الاستعلام. جهة الخادم. */
    PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    /**
     * pg بيستسلم عن القراءة. جهة العميل، وشبكة أمان خلف اللي قبله:
     * لازم تكون **أكبر** من statement_timeout عشان إلغاء الخادم يفوز بالعادة
     * (خطأ نظيف والاتصال بيضل صالح)، وهاي ما بتشتغل إلا لما الخادم ما يرد
     * أصلا — شبكة انقطعت بنص استعلام.
     */
    PG_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  // 🔴 Brief م-ج: a `sending` message is failed as `expired` once it is
  //    STAFF_REPLY_MAX_WAIT_SECONDS past its claim. Were that shorter than
  //    the longest send can take, a send still under way would be failed —
  //    and staff would send it again by hand: twice. So the engine refuses
  //    to start.
  .superRefine((e, ctx) => {
    const longest = staffReplyLongestSendMs(e.WHATSAPP_SEND_TIMEOUT_MS);
    if (e.STAFF_REPLY_MAX_WAIT_SECONDS * 1000 <= longest)
      ctx.addIssue({
        code: "custom",
        path: ["STAFF_REPLY_MAX_WAIT_SECONDS"],
        message: `must be more than the longest staff-reply send, ${longest} ms (3 × WHATSAPP_SEND_TIMEOUT_MS + 8000)`,
      });
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * The longest a staff message's send can take (brief م-ج): three attempts
 * of at most `timeoutMs` each, and the 2 s and 6 s between them —
 * `STAFF_REPLY_RETRY_DELAYS_MS` of `notify/staff-replies.ts`, whose test
 * holds the two together (here, an import would be a cycle through
 * logger.ts).
 */
export function staffReplyLongestSendMs(timeoutMs: number): number {
  return 3 * timeoutMs + 8000;
}

/**
 * The settings in `source`, checked — or a throw naming every bad one.
 * `env()` runs it once on `process.env`; exported for the startup check's
 * test.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`إعدادات البيئة غير صالحة:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}
