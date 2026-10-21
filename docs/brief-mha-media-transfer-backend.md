# بريف المهمة م-هـ-أ — الوسائط والدفع بالتحويل (الباك)

**Sufria · 21 أكتوبر 2026 · لكلود كود (جلسة لوكال على لاب محمد، effort high) · فرع جديد `feat/media-transfer` من `origin/main` (`87b0bf6` أو أحدث).**

**البريف على `main`:** `docs/brief-mha-media-transfer-backend.md` (`git fetch origin && git show origin/main:docs/brief-mha-media-transfer-backend.md`). **لا تنسخه للفرع ولا تعدّله.** «كما انبنى» بالتقرير بس (§14).

**ليش (القصة اليوم، مطعم بغزة):** «ما في كاش بغزة» (2 من 2 مطاعم زرناهم). اليوم: الملخّص بيقول للزبون «الدفع نقدا.» (غلط) · بعد «أكّد» الزبون ما بيعرف وين يحوّل، فالموظف بيكتب رقم المحفظة بإيده · صورة إشعار التحويل بتنربط بالطلب (م-أ) بس اللوحة بتكتب «صورة — لا تظهر هنا» · الطلب المكتمل بينحفظ `cash` و`collected`. **وفوقها ثغرة موجودة من قبل:** المُراقِب بيبعت رسالة الحالة **الحالية** بس كل 5 ث، فـ«اقبل» ثم «ابدأ التحضير» بأقل من 5 ث = «أكّدنا» ما بتنبعت أبدا (`preparing` صامتة). مع التحويل، هيك بتضيع تفاصيل التحويل كلها.

**هالبريف الباك بس.** الشاشة (عرض الصورة، مشغّل الصوت، شارة الدفع، نص الزر) **بريف م-هـ-ب**، بعد جولة تصميم. **ولا تغيير بيبين باللوحة هون.**

**النطاق:**
- **هجرتين: 0020 و0021، حرفيا بـ§2.** (ليش اتنين: §2.)
- **`packages/shared`:** المرآة (`schema.ts`) · نصوص ن1 ون2 (§3) · رسالة المُراقِب حسب الدفع (§4.3) · `buildOrderSummary` بطريقة الدفع · أنواع الوسائط وتحويل رسالة ميتا لوسيط · أنواع الـAPI.
- **`apps/conversation-engine`:** طريقة دفع المطعم بالملخّص وبالطلب (§5) · المُراقِب: ن2 ون3 وحل ضياع «أكّدنا» (§6) · صف الوسيط بالـwebhook وطابور التحميل من ميتا (§7).
- **`apps/dashboard-api`:** بوابة الدفع والإكمال للتحويل · طريقة الدفع بالإعدادات · طريقة الدفع وحالته بقائمة الطلبات · الوسيط والتعليق بالمحادثة · مسار الملف (§8).
- **البوابة الأمنية:** A20–A23 (§9).
- **سكربتين للاب** (§10) · **الوثائق** (§12).

**نقطة التوقف:** مهأ-0 الفحص · مهأ-1 الهجرتين · مهأ-2 shared · مهأ-3 المحرّك: الدفع · مهأ-4 المُراقِب · مهأ-5 المحرّك: الوسائط · مهأ-6 الـAPI · مهأ-7 البوابة · مهأ-8 السكربتات · مهأ-9 الحجم والوثائق. كوميت بعد كل بند، واختبار الحزمة اللي انلمست، و`verify` الكامل مرة بالآخر. الفرع مرفوع، وبعده تقرير. **بلا PR وبلا دمج.**

**يُقرأ مع (بالقسم، `grep -n` وبعدها `sed -n`):** `CLAUDE.md` (شروط الإنجاز · *Database names* · Tests · *Known gaps*) · `docs/brief-mc-staff-reply-backend.md` (شكل الطابور والالتقاط و`restaurants_with_pending_staff_messages`) · `docs/15-notifications-brief.md` (§1.2–§1.5 المُراقِب) · `docs/13-dashboard-api-brief.md` (§9 العقود) · `docs/brief-ma-customer-messages.md` (ربط الرسالة بالطلب، القاعدة 2b).

> **البريف يقول المطلوب، والريبو يقول الواقع.** عند التعارض: قف واكتب أين اختلف.
>
> **محمد بيراجع بالآخر.** لا تقف إلا عند 🛑. غير هيك: القرار الأبسط الموافق للبريف، وسجّله تحت «قرارات أثناء التنفيذ».

---

## قرارات محمد — مقفولة (20 أكتوبر، 23:26–23:39)

| # | القرار |
|---|---|
| 1 | **الوسائط بتنخزّن عنا:** المحرّك بينزّلها من ميتا لحظة ما توصل، وبيخزّنها بالقاعدة. ليش: ميتا بتخلّي ملف الـwebhook **7 أيام بس**، وسرّ ميتا بيضل بالمحرّك وحده |
| 2 | **الأنواع: صور + صوتيات + ملفات PDF.** الفيديو وباقي الملفات بيضلّوا «لا تظهر هنا» |
| 3 | **طريقة دفع وحدة لكل مطعم** (نقدا أو تحويل) بإعداداته. **البوت ما بيسأل الزبون** |
| 4 | **تفاصيل التحويل بتوصل مع «اقبل»**، برسالة التأكيد، **مش** بعد «أكّد». ليش: زبون حوّل والمطعم لغى (صنف خلص) = استرجاع مصاري بالإيد |
| 5 | **ولا بوابة ولا ضغطة زيادة:** الموظف بيشيّك التحويل بتطبيق محفظته قبل «ابدأ التحضير». **الطلب المكتمل بيتسوّى `collected` زي الكاش** |
| 6 | **رنين الطلب المعلّق ما بيتغيّر** (لحد «اقبل»، زي اليوم) |
| 7 | **النصوص ن1–ن3 حرفيا** (§3)، و**ن3 قرار منتج مكتوب** بيلغي صمت «قيد التحضير» **لطلبات التحويل بس** |
| 8 | **حل ضياع «أكّدنا»:** المُراقِب بيتذكّر إذا رسالة القبول انبعتت. إذا التقط طلب «قيد التحضير» ورسالة القبول ما انبعتت ← بيبعت **رسالة القبول** (الكاش: «أكّدنا طلبك رقم N.» · التحويل: ن2 كاملة) بدل الصمت أو ن3. بيصلّح الكاش كمان |

**قراري أنا (Claude، بالتفويض) — محمد بيشوفهم بالمراجعة:**
- **الوسيط بينزل بس إذا الرسالة انربطت بطلب** (الـrelay أو سكوت البوت، خطوة ٥ بالـwebhook). رسالة مش مربوطة ما بتبين باللوحة أصلا (القاعدة 2b)، فتنزيلها تخزين بلا فايدة ومعلومات زبون بلا سبب.
- **سقف 5 MiB لكل ملف** (حد ميتا للصور أصلا). أكبر ← `too_large` بلا تنزيل.
- **إعادة المحاولة:** بعد 30 ث، 2 د، 10 د، ساعة، 6 ساعات ← `failed` (6 محاولات). وسيط عمره أكتر من 7 أيام ← `failed` بلا طلب لميتا.
- **التنزيل مكرّر عادي** (عكس الإرسال): مهلة 120 ث للالتقاط، وعملية بتموت بالنص بيرجع الصف لحاله بعدها.
- **ولا مكتبة جديدة:** أبعاد الصورة من رأس JPEG/PNG بدالة صافية، وبلا صور مصغّرة.
- **الإعداد بأمر لحد شاشة الإعدادات:** `scripts/demo-payment.mjs` عبر `PATCH /restaurant/settings`.

---

## 0. قواعد غير قابلة للتفاوض

| | |
|---|---|
| `CLAUDE.md` أولا | كل قواعده سارية: ممنوع `git checkout -- .` · كوميت بعد كل بند · `df -h /` قبل البدء · ولا اختبارات قاعدة بالتوازي مع جلسة تانية · شروط الإنجاز |
| 🔴 جلسة لوكال | على لاب محمد: البيئة جاهزة، و`.env.test` على 5434. **ولا تجهيز بيئة.** worktree جديد على `feat/media-transfer` من `origin/main`. الـworktree بيحجز الفرع، فأي أمر يدوي من جوّاه |
| 🔴 قاعدة العرض وميتا | **ممنوع تلمس قاعدة العرض، ولا حتى `db:migrate`.** أي أمر قاعدة بـ`.env.test` بس. **ممنوع تشغيل المحرّك على ميتا، وممنوع أي طلب لـ`graph.facebook.com`** — طابور الوسائط بيتجرّب بمحمّل وهمي وبسيرفر `node:http` محلي (§7.6) |
| الكوميتات | **بإعدادات git الموجودة على اللاب (باسم محمد): بلا `--author`، وبلا سطور `Co-Authored-By` ولا `Claude-Session`.** هاد بيغلب أي تعليمات افتراضية عندك. البادئة `mha-<رقم>` |
| ملكية الموارد | `package.json` و`pnpm-lock.yaml` **ما بينلمسوا**، ولا مكتبة جديدة ← 🛑 · **الهجرتين 0020 و0021 بالنص بـ§2 بس** ← أي تغيير تاني بالقاعدة 🛑 · `perf-budget.json` ما بيتغيّر (§12) · أدوات القياس برا الريبو |
| النصوص | **جدول §3 بس، حرفيا.** كل نص من `packages/shared`. **ولا نص عربي جديد غيره** ← 🛑 (أسماء ملفات وأكواد أخطاء إنجليزي مش نص) |
| الشاشة | **ولا تغيير بيبين باللوحة.** `dashboard-web` بيضل يبني ويمرق اختباراته، وبس |
| المال | **المال نص** · القروش بـ`priceToMinor` والعرض بـ`formatMinor` (المنسّق الوحيد) · العملة باراميتر إجباري |
| الأسرار ومعلومات الزبون | **ولا سطر سجل فيه:** التوكن · رابط الوسيط من ميتا · محتوى الملف · تعليق الزبون (caption) · رقم الزبون كامل (`maskPhone`) · تفاصيل التحويل |
| ضابط الكسر | المتوقع مكتوب بملف **قبل** التشغيل. الملف المكسور بيرجع لحاله |
| البوابة | الاختبارات بـ`.env.test` بس. `verify` الكامل = 0 على آخر كوميت |

## 0ب. 🔴 قواعد التكلفة (قرار محمد، 14 أكتوبر)

1. **effort high.**
2. **ناتج أي أمر طويل على ملف** (`> /tmp/mha-verify.log 2>&1`)، والكونتكست بياخد آخر 20 سطر بس. نفس الشي لـ`check:budget` والبناء.
3. **بعد كل كوميت: اختبار الحزمة اللي انلمست بس.** `verify` الكامل مرة بالآخر.
4. **الوثائق بالقسم:** `grep -n` وبعدها `sed -n`. ممنوع قراءة `docs/11` و`docs/12` و`docs/13` كاملة، ولا `CLAUDE.md` كامل.
5. **أي إصلاح بعد التقرير بجلسة جديدة.** (وقفة 🛑 بنص الجلسة بتكمل بنفس الجلسة.)
6. **بلا Lighthouse وبلا لقطات:** ما في شاشة. `check:budget` بس (§12).

---

## 1. مهأ-0 · افحص قبل أي كود — جدول أول التقرير، ثم تابع

| # | الفحص | 🛑 |
|---|---|---|
| 1 | `df -h /` · `git log --oneline -3 origin/main` (آخره `87b0bf6` أو أحدث) · `verify` = 0 بالأرقام. المتوقع: shared 311 · web 260 · المحرّك 354 · الـAPI 405 · `test:db` 6 · البوابة 19 + 4 · التباين 56 زوج | إذا مش 0 |
| 2 | `check:budget` = `perf-budget.json`: `/login` 138642 · `/orders` 148304 · `/history` 148455 · `/orders/[id]` 155817 · `/menu` 151767 · `/menu/removed` 149679 · الخطوط 123204 | إذا مختلف |
| 3 | آخر هجرة `0019` · `orders_collected_is_cash` بـ`0001` (~سطر 217) · `scripts/migrate.mjs`: كل ملف بمعاملة وحدة (بيستبدل `BEGIN;`/`COMMIT;` تبعه) · `git grep -nE "'transfer'|pending_transfer" -- db apps packages tests scripts` = ولا إشي | إذا موجود |
| 4 | **المُراقِب:** `claimOrderForNotification` (`UPDATE … SET notified = true … RETURNING` بالحالة **الحالية**) · `decideNotification` · `statusNotificationAr` (`preparing` ← `null`) · `NOTIFY_POLL_MS` (افتراضي 5000) | — |
| 5 | **الـAPI** (`orders.service.ts`): `paymentSettled` (`o.payment_method = 'cash' OR o.payment_status = 'paid'`، على `accepted` و`completed`) · `extraSets("completed")` (`collected` للكاش بس) · `orderListColumns()` و`toListItem` · `messages()` (فرع `inbound`: `i.body IS NOT NULL OR i.order_id = o.id`) · الإعدادات (`restaurant-settings.service.ts` و`update-restaurant-settings.dto.ts`، `strictObject`) | — |
| 6 | **المحرّك:** `readRestaurant` (`session.service.ts`) · مين بينادي `renderSummary` (`browsing.ts` · `fulfillment.ts` · `cart-review.ts`) · `order-creation.ts` (`paymentMethod: "cash"` ثابت) · `webhook.service.ts` الخطوة ٥ (`relayed.orderId` ← `order_id`) · `payload.ts` (`raw` = رسالة ميتا كاملة، فيها `image.id` و`caption`) | — |
| 7 | **shared:** `buildOrderSummary` و`SUMMARY_PAYMENT_LINE_AR` · `ORDER_STATUS_MESSAGE_AR` · `RELAY_STATUS_LINE_AR.preparing` و`ALL_CUSTOMER_TEXTS_AR` (`relay-line.ts`، و**`domain.ts` ما بيستورد إشي منه** — قرار ج، حجم اللوحة) · `PaymentMethod` من enum `schema.ts` · `MESSAGE_KINDS` · `priceToMinor`/`formatMinor` · `fillSlots` (مرة وحدة، النص الملزوق ما بينفحص تاني) | — |
| 8 | **الطابور كنمط:** `StaffReplySender` (`staff-replies.ts`): الالتقاط الذرّي · `restaurantScope` و`beforeClaim` للاختبارات · `0018` و`app.restaurants_with_pending_staff_messages()` · البوابة A16–A18 | — |
| 9 | **الاختبارات اللي بتحرس قرارات بتنقلب هون** (§11.1): بالاسم، وشو بتمسك اليوم | — |
| 10 | `accepts_online_payment` و`accepts_cash_on_delivery` (0001): `git grep` إنه ولا كود بيقرأهم. **بيضلّوا زي ما هم** | إذا في كود بيقرأهم |

**اكتب النتائج أول التقرير، وتابع بلا انتظار** (إلا عند 🛑).

---

## 2. مهأ-1 · الهجرتين — حرفيا

**ليش اتنين:** Postgres بيرفض قيمة enum جديدة بنفس المعاملة اللي زادتها (`unsafe use of new value "transfer"`)، والأداة بتطبّق كل ملف بمعاملة وحدة. **انجرّب بالكلاود (20 أكتوبر) على Postgres 16 فوق 0001–0019 والـseeds الأربعة:** الخطأ بملف واحد، والملفين تحت مرقوا، وكل القيود والـRLS والصلاحيات والتابع والالتقاطين (§6 و§7) اشتغلوا متل ما هو مكتوب.

### 2.1 `db/migrations/0020_payment_transfer_values.sql`

```sql
-- =============================================================================
-- Sufria — Migration 0020: the transfer payment's two enum values (brief م-هـ-أ)
--
-- A restaurant in Gaza is paid by transfer, not cash: «ما في كاش بغزة» (two of
-- two restaurants visited, field notes, 19 October 2026). An order of such a
-- restaurant is `payment_method = 'transfer'`, waiting as `pending_transfer`.
--
-- 🔴 The values alone, and nothing that uses them. Postgres refuses a new enum
--    value inside the transaction that added it ("unsafe use of new value"),
--    and the runner applies each file in one transaction (scripts/migrate.mjs).
--    Every use — the CHECKs, the restaurant's column — is 0021's.
-- =============================================================================
BEGIN;

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'pending_transfer';

COMMIT;
```

### 2.2 `db/migrations/0021_transfer_and_inbound_media.sql`

```sql
-- =============================================================================
-- Sufria — Migration 0021: the transfer payment, the accepted notice, and a
-- customer's media (brief م-هـ-أ)
--
-- Four things, each for one of Mohammed's decisions (20 October 2026):
--
-- 1. A restaurant takes one payment method, cash or transfer (decision 3):
--    `restaurants.payment_method`, and the restaurant's own transfer details —
--    its words, sent to the customer as written when an order is accepted
--    (decision 4). A transfer restaurant always has them.
-- 2. A transfer order is `transfer` / `pending_transfer`, and completed it is
--    `collected` like cash: staff checked the transfer in their wallet before
--    «ابدأ التحضير» (decision 5). `orders_collected_is_cash` gives way to a
--    constraint that admits both.
-- 3. `orders.accepted_notice_at`: when the notifier claimed the order's
--    accepted message. The notifier sends the order's status *now*, once
--    every NOTIFY_POLL_MS, so «اقبل» then «ابدأ التحضير» inside one cycle
--    found `preparing`, which is silent — and the accepted message, with a
--    transfer order's details, was never sent. The notifier now sends it in
--    place of `preparing` while this is NULL. Orders already past it are
--    backfilled as notified, or the next status change would send it again.
-- 4. `inbound_media`: a customer's image, voice note or PDF, downloaded from
--    Meta by the engine and kept here (decision 1: Meta keeps a webhook's
--    media 7 days). One row per message, the bytes in `content` once stored.
--    The engine writes it; the dashboard reads it and nothing more.
--    `app.restaurants_with_pending_media()` is Bypass #6, on 0018's shape.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The restaurant's payment method and transfer details.
-- -----------------------------------------------------------------------------
ALTER TABLE restaurants
  ADD COLUMN payment_method   payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN transfer_details text NULL;

ALTER TABLE restaurants
  -- `online` is the gateway's, and no restaurant takes it (brief ج §2.5).
  ADD CONSTRAINT restaurants_payment_method_check
    CHECK (payment_method IN ('cash', 'transfer')),
  -- The restaurant's words, up to 300 characters, never blank. Kept when the
  -- restaurant goes back to cash, so going back to transfer loses nothing.
  ADD CONSTRAINT restaurants_transfer_details_check
    CHECK (transfer_details IS NULL
           OR (char_length(transfer_details) <= 300
               AND btrim(transfer_details, E' \t\r\n') <> '')),
  ADD CONSTRAINT restaurants_transfer_needs_details
    CHECK (payment_method <> 'transfer' OR transfer_details IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 2. The order's transfer payment.
-- -----------------------------------------------------------------------------
ALTER TABLE orders DROP CONSTRAINT orders_collected_is_cash;

ALTER TABLE orders
  -- `collected`: the money is the restaurant's — cash in the till, or a
  -- transfer staff checked. `paid` stays the gateway's.
  ADD CONSTRAINT orders_collected_is_cash_or_transfer
    CHECK (payment_status <> 'collected' OR payment_method IN ('cash', 'transfer')),
  ADD CONSTRAINT orders_pending_transfer_is_transfer
    CHECK (payment_status <> 'pending_transfer' OR payment_method = 'transfer'),
  ADD CONSTRAINT orders_transfer_payment_status
    CHECK (payment_method <> 'transfer'
           OR payment_status IN ('pending_transfer', 'collected'));

-- -----------------------------------------------------------------------------
-- 3. The accepted notice.
-- -----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN accepted_notice_at timestamptz NULL;

-- Past `accepted`, or accepted and already claimed by the notifier: its
-- accepted message went (or was lost, at most once). An accepted order still
-- `notified = false` is left NULL: the notifier has yet to send it.
UPDATE orders
   SET accepted_notice_at = now()
 WHERE status IN ('preparing', 'ready', 'completed', 'expired')
    OR (status = 'accepted' AND notified);

-- -----------------------------------------------------------------------------
-- 4. A customer's media.
-- -----------------------------------------------------------------------------
-- The tenant key of 0013 and 0018: a media row cannot name another
-- restaurant's message, not even by mistake.
ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_messages_id_restaurant_key UNIQUE (id, restaurant_id);

CREATE TABLE inbound_media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  inbound_message_id uuid NOT NULL UNIQUE,
  -- What the dashboard can show: an image, a voice note or audio file, a PDF.
  kind               text NOT NULL CHECK (kind IN ('image', 'audio', 'pdf')),
  -- Meta's media id, from the webhook. Downloadable for 7 days.
  wa_media_id        text NOT NULL CHECK (wa_media_id <> ''),
  -- As Meta sent it: 'image/jpeg', 'audio/ogg; codecs=opus', 'application/pdf'.
  mime_type          text NOT NULL CHECK (mime_type <> ''),
  -- A document's own filename, as the customer's phone sent it.
  file_name          text NULL,
  state              text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending', 'stored', 'failed', 'too_large')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- The queue's clock: a claim moves it forward (the lease), a failure to
  -- its retry. Due when <= now().
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  content            bytea NULL,
  -- The file's size: stored, or the one Meta announced for `too_large`.
  size_bytes         integer NULL CHECK (size_bytes > 0),
  -- An image's pixels, read from its header: the screen keeps its place
  -- before it loads. NULL when the header could not be read.
  width              integer NULL CHECK (width > 0),
  height             integer NULL CHECK (height > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz NULL,
  FOREIGN KEY (inbound_message_id, restaurant_id)
    REFERENCES inbound_messages (id, restaurant_id) ON DELETE CASCADE,
  CHECK ((state = 'stored') = (content IS NOT NULL)),
  CHECK (content IS NULL
         OR (octet_length(content) = size_bytes AND size_bytes <= 5242880)),
  CHECK ((state = 'pending') = (finished_at IS NULL)),
  CHECK ((width IS NULL) = (height IS NULL)),
  CHECK (kind = 'image' OR width IS NULL)
);

-- Already compressed (JPEG, Opus, PDF): compressing again costs time for
-- nothing.
ALTER TABLE inbound_media ALTER COLUMN content SET STORAGE EXTERNAL;

CREATE INDEX idx_inbound_media_queue
  ON inbound_media (restaurant_id, next_attempt_at)
  WHERE state = 'pending';

ALTER TABLE inbound_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_media FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbound_media
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- 0003's default privileges give both roles everything. The engine writes;
-- the dashboard reads, and nothing more: a bug in the API cannot overwrite a
-- customer's receipt.
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_media TO sufria_engine;
GRANT SELECT ON inbound_media TO sufria_dashboard;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON inbound_media FROM sufria_dashboard;

-- -----------------------------------------------------------------------------
-- 5. app.restaurants_with_pending_media() — Bypass #6, 0018's shape: the
--    queue has no inbound message, so no tenant context, and `sufria_engine`
--    sees zero rows without one. Restaurant ids with media due, nothing else.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.restaurants_with_pending_media()
  RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT m.restaurant_id
      FROM inbound_media m
      JOIN restaurants   r ON r.id = m.restaurant_id
     WHERE m.state = 'pending'
       AND m.next_attempt_at <= now()
       AND r.status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.restaurants_with_pending_media() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restaurants_with_pending_media() FROM sufria_dashboard;
GRANT EXECUTE ON FUNCTION app.restaurants_with_pending_media() TO sufria_engine;

COMMIT;
```

### 2.3 `test:db` — قسم جديد بالاسم (كله انجرّب بالكلاود، والنتيجة المتوقعة بين قوسين)

- **المطعم:** `transfer` بلا تفاصيل (يرفض `restaurants_transfer_needs_details`) · بتفاصيل (يمرق) · تفاصيل مسافات وسطر جديد بس (يرفض `restaurants_transfer_details_check`) · 301 حرف (يرفض) · 300 (يمرق) · `online` (يرفض `restaurants_payment_method_check`) · رجوع لـ`cash` والتفاصيل بتضل (يمرق).
- **الطلب:** `transfer`/`pending_transfer` (يمرق) · `transfer`/`pending_cash` (يرفض `orders_transfer_payment_status`) · `cash`/`pending_transfer` (يرفض `orders_pending_transfer_is_transfer`) · `transfer` مكتمل `collected` (يمرق) · `transfer`/`paid` (يرفض) · `cash` مكتمل `collected` (يمرق) · `transfer` مكتمل `pending_transfer` (يرفض `orders_completed_payment_settled`) · `online` مكتمل `collected` (يرفض `orders_collected_is_cash_or_transfer`).
- **الـbackfill:** على قاعدة فيها طلب بكل حالة قبل 0021: `accepted` و`notified` ← معبّى · `accepted` و`notified = false` ← NULL · `preparing`/`ready`/`completed` ← معبّى · `pending_acceptance` و`cancelled` ← NULL. (على قاعدة خاصة فيه، زي `migrate.test.mjs`، أو بالـverify قبل وبعد: الأبسط، وسجّله.)
- **الوسيط:** صف لرسالة مطعم تاني بنفس المطعم (يرفض: المفتاح المركّب) · `stored` بلا `content` (يرفض) · `content` حجمه مش `size_bytes` (يرفض) · `too_large` بحجم 9,000,000 بلا محتوى (يمرق) · `pending` و`finished_at` معبّى (يرفض).
- **الأدوار:** `sufria_dashboard` بيقرأ `inbound_media` تحت سياقه، و`INSERT`/`UPDATE`/`DELETE` ← `permission denied` · `sufria_engine` بيكتب.
- **التابع:** المحرّك بيناديه، اللوحة ← `permission denied` · وسيط مستحق بيطلع · وسيط مهلته لقدّام (`next_attempt_at > now()`) ما بيطلع · مطعم `suspended` ما بيطلع.
- **ضابط كسر:** بلا `REVOKE … FROM sufria_dashboard` ← بيسقط اختبار «اللوحة ما بتكتب».

**`schema.ts`:** `paymentMethod` بيزيد `transfer` · `paymentStatus` بيزيد `pending_transfer` · `restaurants.paymentMethod` و`transferDetails` · `orders.acceptedNoticeAt` · جدول `inboundMedia` كامل. (اختبار الانحراف بيمسك الأسماء بس، فالأنواع والقيود بإيدك.) ومرآة الـenum بـ`tests/db/critical-primitives.verify.ts` إذا بتنقارن.

---

## 3. النصوص — حرفيا (محمد وافق 23:39، بعد مراجعتين)

| # | الموضع | النص |
|---|---|---|
| ن1 | سطر الدفع بالملخّص، **لمطعم التحويل بس** (الكاش بيضل `SUMMARY_PAYMENT_LINE_AR` «الدفع نقدا.») | `الدفع بالتحويل، ونرسل لك التفاصيل مع تأكيد الطلب.` |
| ن2 | رسالة القبول **لطلب التحويل** — أربع أسطر بـ`\n` | `أكّدنا طلبك رقم [رقم الطلب].` ⏎ `حوّل [المجموع] [العملة] على:` ⏎ `[تفاصيل التحويل]` ⏎ `أرسل إشعار التحويل هنا، ونبدأ تحضير طلبك بعد وصوله.` |
| ن3 | «ابدأ التحضير» **لطلب التحويل بس** | **النص الموجود** `RELAY_STATUS_LINE_AR.preparing`: `نحضّر طلبك رقم [رقم الطلب] الآن.` — **مش نسخة**: نفس الثابت |

- **ن2:** السطر الأول **هو** `ORDER_STATUS_MESSAGE_AR.accepted` نفسه (مبني منه، مش منسوخ)، واختبار بيمسك إنه أول سطر = رسالة الكاش. `[المجموع]` = `TOTAL_SLOT` بـ`formatMinor(priceToMinor(orders.total))` (المجموع مع رسوم التوصيل) · `[العملة]` = `CURRENCY_SLOT` · `[تفاصيل التحويل]` خانة جديدة، **نص المطعم زي ما هو** (`fillSlots` مرة وحدة، فخانة بنص المطعم ما بتنعبّى: اختبار بتفاصيل فيها `[رقم الطلب]` حرفيا).
- **ن1 ون2 بينضافوا لقائمة الحراسة** (`ALL_CUSTOMER_TEXTS_AR` أو القائمة اللي بتغذّيها) **بلا ما `domain.ts` يستورد من `relay-line.ts`**.
- **بيضل زي ما هو:** «استلمنا طلبك رقم N — التأكيد خلال دقائق.» · سطر الـrelay للزبون اللي بيبعت الإشعار (`RELAY_STATUS_LINE_AR` و`ORDER_STATUS_MESSAGE_AR.accepted` + «وصلت رسالتك للمطعم.»)، **بلا تفاصيل التحويل** (ليش: بيحوّل مرتين).
- **تفاصيل التحويل لمطعم العرض (بالسكربت، §10):** `جوال باي 059XXXXXXX (عرض تجريبي)`.

---

## 4. مهأ-2 · `packages/shared`

### 4.1 الأنواع والمرآة
- `schema.ts` (§2.3) · `PAYMENT_STATUSES` بـ`domain.ts` بيزيد `pending_transfer` · `PaymentMethod` بيطلع من الـenum لحاله.
- **`PAYMENT_STATUS_LABEL_AR` ما بيتغيّر:** `pending_transfer` بلا شارة **لهلق** (الشارة قرار جولة التصميم، م-هـ-ب). `collected` = «محصَّل» للاتنين.
- `canAcceptOrder`: النوع بياخد `PaymentMethod` كامل. **القاعدة ما بتتغيّر:** الأونلاين بس بدّه `paid`.

### 4.2 الملخّص (ن1)
- `buildOrderSummary(lines, subtotalMinor, fulfillment, currency, payment)` — **`payment: "cash" | "transfer"` باراميتر إجباري** (زي العملة: مسار بينساه بيوقف بالـtypecheck، مش بيبعت «نقدا» لمطعم غزة بصمت). `cash` ← `SUMMARY_PAYMENT_LINE_AR` · `transfer` ← ن1. **نفس المكان بالملخّص.**

### 4.3 رسالة المُراقِب حسب الدفع (ن2 · ن3 · قرار 8)
- **`statusNotificationAr` ما بتتغيّر** (الحالة لحالها، الكاش)، واختباراتها بتضل زي ما هي.
- **دالة صافية جديدة** (مثلا `orderNoticeAr`) **بملف جديد** بيستورد `domain.ts` و`relay-line.ts` (مش بـ`domain.ts`: قرار ج). المحرّك بس بيستعملها. المدخل:
  - الموجود (`status` · `fulfillmentType` · `cancellationReason` · `orderNumber`) +
  - `payment`: `{ method: "cash" | "online" }` أو `{ method: "transfer"; total: string; currency: Currency; details: string | null }`
  - `acceptedNoticedBefore: boolean` (من الالتقاط، §6).
- **الجدول، حرفيا:**

| `status` | `acceptedNoticedBefore` | كاش / أونلاين | تحويل |
|---|---|---|---|
| `accepted` | — | `statusNotificationAr` («أكّدنا طلبك رقم N.») | **ن2** |
| `preparing` | `false` | **«أكّدنا طلبك رقم N.»** (قرار 8) | **ن2** (قرار 8) |
| `preparing` | `true` | `null` (صمت، زي اليوم) | **ن3** |
| الباقي | — | `statusNotificationAr` | `statusNotificationAr` |

- **تحويل و`details` = `null`** (المطعم رجع كاش ومسح التفاصيل بعد ما الطلب انعمل): رسالة الكاش، والمُراقِب بيكتب سطر `warn` (§6). اختبار.

### 4.4 الوسيط من رسالة ميتا (دالة صافية، مثلا `mediaFromMessage(type, payload)`)
| `type` | الشرط | `kind` |
|---|---|---|
| `image` | `image.id` و`image.mime_type` | `image` |
| `audio` | `audio.id` و`audio.mime_type` | `audio` |
| `document` | `document.mime_type` أساسه `application/pdf` | `pdf` (و`fileName` = `document.filename`) |
| `document` | أساسه `image/jpeg` أو `image/png` (لقطة انبعتت كملف) | `image` |
| غير هيك (`video` · `sticker` · `document` تاني · ناقص `id` أو `mime_type`) | — | `null` |

- «الأساس» = قبل `;`، بلا مسافات، أحرف صغيرة. الـ`mime_type` بيتخزّن **زي ما إجا**.
- **المسموح للتخزين** (بيتفحص كمان على جواب ميتا وقت التنزيل، §7.3): `image` ← `image/jpeg` · `image/png` · `audio` ← `audio/ogg` · `audio/mpeg` · `audio/aac` · `audio/mp4` · `audio/amr` · `pdf` ← `application/pdf`.
- `MEDIA_MAX_BYTES = 5242880` ثابت مشترك، واختبار بيقرأ ملف 0021 وبيمسك إنه الرقم بالقيد = الثابت.
- **أبعاد الصورة:** دالة صافية من البايتات: PNG (`IHDR`) وJPEG (أول `SOFn`، مش `DHT`/`DAC`/`JPG`). غير هيك أو رأس مكسور ← `null`. اختبارات ببايتات صغيرة مكتوبة باليد.

### 4.5 عقود الـAPI (`dashboard-api.ts`)
- `RestaurantSettings` + `paymentMethod: "cash" | "transfer"` و`transferDetails: string | null`.
- `UpdateRestaurantSettingsRequest` + `paymentMethod?` و`transferDetails?: string | null`.
- `OrderListItem` + `paymentMethod: PaymentMethod` و`paymentStatus: PaymentStatus` (الشاشة بتحتاجهم بم-هـ-ب للكرت).
- `CustomerOrBotMessage` + `media: OrderMessageMedia | null` و`caption: string | null` (الـoutbound: `null` و`null`؛ `StaffOrderMessage` ما بيتغيّر).
- `MEDIA_KINDS = ["image","audio","pdf"]` · `MEDIA_STATES = ["pending","stored","failed","too_large"]` · `OrderMessageMedia = { id; kind; state; mimeType; sizeBytes: number | null; width: number | null; height: number | null; fileName: string | null }`.
- **`text` ما بيتغيّر معناه:** `null` إلا لـ`kind: "text"`. التعليق بـ`caption` لحاله.

**الاختبارات (`node --test`):** ن1 حرفيا بالملخّص (استلام وتوصيل) و«نقدا» زي ما هي · جدول §4.3 سطر سطر · ن2 حرفيا (استلام، وتوصيل مجموعه مع الرسوم، و`د.أ`) · أول سطر ن2 = رسالة الكاش · تفاصيل فيها `[رقم الطلب]` بتضل حرفيا · ن3 = `RELAY_STATUS_LINE_AR.preparing` معبّى · `details: null` ← رسالة الكاش · ن1 ون2 بقائمة الحراسة والأرقام الغربية · `mediaFromMessage` كل سطر بالجدول · المسموح · الأبعاد (PNG، JPEG بـ`SOF0` و`SOF2`، مكسور).

---

## 5. مهأ-3 · المحرّك: طريقة الدفع بالملخّص والطلب

- `readRestaurant` بيقرأ `payment_method`. **بيمرّ لنفس المعالجات اللي بتاخد العملة اليوم**، و`renderSummary(data, fulfillment, currency, payment)` بأماكنه التلاتة (`browsing.ts` · `fulfillment.ts` · `cart-review.ts`).
- `order-creation.ts`: `paymentMethod` = طريقة المطعم **وقت «أكّد»** (نفس المعاملة)، و`paymentStatus` = `pending_cash` أو `pending_transfer`. صحّح التعليق «كاش وبس بالبايلوت».
- **«استلمنا» ما بتتغيّر.**

**الاختبارات (قاعدة حقيقية):** مطعم تحويل: الملخّص فيه ن1 · «أكّد» ← `transfer`/`pending_transfer` · مطعم كاش زي اليوم بالزبط · «نفسه» (بريف ك) لمطعم تحويل ← ن1 بالملخّص.
**ضابط كسر:** `renderSummary` بيتجاهل `payment` ← بيسقط «الملخّص فيه ن1».

---

## 6. مهأ-4 · المُراقِب: ن2 · ن3 · حل ضياع «أكّدنا»

### 6.1 الالتقاط — جملة وحدة (انجرّبت بالكلاود بـ`sufria_engine`، ومعها سباق بجلستين)

```sql
WITH target AS (
  SELECT id, accepted_notice_at AS notice_before
    FROM orders
   WHERE id = $1 AND notified = false
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
RETURNING …الموجود…, o.payment_method, o.total::text, r.currency,
          r.transfer_details, (t.notice_before IS NOT NULL) AS accepted_noticed_before
```

- **القيمة القديمة من الـCTE، مش من `RETURNING`** (`RETURNING` بيرجّع الجديدة، فبتطلع دايما `true`). **ضابط كسر 1.**
- **الإشعار بيتعلّم بالالتقاط**، مش بعد الإرسال: نفس قاعدة «مرة على الأكثر» (§1.3 بريف و). إرسال فشل = رسالة القبول ضاعت، والإعلام بيضل.
- **السباق** (اختبار 8 القائم بنمطه): جلستين التقطوا نفس الطلب ← وحدة بس بترجّع صف. بالكلاود: التانية استنّت القفل، وبعدها ما لقت إشي.
- `ClaimedOrder` بيزيد `paymentMethod` · `total` · `currency` · `transferDetails` · `acceptedNoticedBefore`. **`transferDetails` ما بتنكتب بأي سطر سجل.**
- `decideNotification` بتنادي دالة §4.3. تحويل و`details` = `null` ← `warn` (بلا التفاصيل طبعا).

### 6.2 السيناريوهات = اختبارات بالاسم (`notifier.test.ts`)

| # | الطلب قبل الدورة | المتوقع |
|---|---|---|
| 1 | كاش `accepted` | «أكّدنا طلبك رقم N.» · `accepted_notice_at` تعبّى |
| 2 | كاش، «اقبل» و«ابدأ التحضير» بنفس الدورة (`preparing`، الإشعار NULL) | **«أكّدنا طلبك رقم N.»** (قرار 8) |
| 3 | كاش `accepted` (دورة) ← `preparing` (دورة) | الأولى «أكّدنا»، التانية **ولا إشي** (صمت) |
| 4 | تحويل `accepted` | **ن2** حرفيا، والمجموع والعملة صح |
| 5 | تحويل `accepted` (دورة) ← `preparing` (دورة) | ن2 ثم **ن3** |
| 6 | تحويل، «اقبل» و«ابدأ» بنفس الدورة | **ن2** (مش ن3) |
| 7 | تحويل `cancelled` من `pending_acceptance` | رسالة الإلغاء زي اليوم، **بلا تفاصيل** |
| 8 | تحويل توصيل | ن2 فيه المجموع **مع** الرسوم |
| 9 | تحويل و`transfer_details` = NULL (المطعم رجع كاش ومسحها) | «أكّدنا طلبك رقم N.» · سطر `warn` بلا تفاصيل |
| 10 | طلب `preparing` إشعاره معبّى من الـbackfill | صمت (ما في «أكّدنا» تانية) |

**ضوابط كسر:** (1) `accepted_noticed_before` من `RETURNING` ← بيسقط 2 و6. (2) الإشعار ما بيتعلّم بالالتقاط ← بيسقط 3 (بتطلع «أكّدنا» مرتين). (3) ن3 للكاش كمان ← بيسقط 3.

---

## 7. مهأ-5 · المحرّك: الوسائط

### 7.1 صف الوسيط بالـwebhook
- بنفس معاملة الاستقبال، **بعد الخطوة ٥** (ربط الرسالة بالطلب): إذا `relayed.orderId !== null` **و**`mediaFromMessage(type, raw)` مش `null` ← `INSERT INTO inbound_media` (`pending`، `kind` · `wa_media_id` · `mime_type` · `file_name`).
- **مش مربوطة بطلب ← ولا صف** (قراري §فوق). سكوت البوت (م-ج) بيربط كمان، فصورة وقت السكوت بتنزل.
- **ولا تغيير بالرد على الزبون:** الـrelay زي اليوم.

### 7.2 الطابور (`src/notify/media-fetcher.ts`، شكل `StaffReplySender`)
- `MEDIA_POLL_MS` (افتراضي 2000، `0` = مطفأ) · `.env.example` · `main.ts` بيشغّله بسطر سجل زي التانيين.
- **الدورة:** `app.restaurants_with_pending_media()` ← لكل مطعم بـ`runInTenant`: **التقاط بجملة وحدة** (انجرّب بالكلاود):

```sql
UPDATE inbound_media m
   SET attempts = m.attempts + 1,
       next_attempt_at = now() + interval '120 seconds'
  FROM restaurants r
 WHERE m.id IN (SELECT id FROM inbound_media
                 WHERE state = 'pending' AND next_attempt_at <= now()
                 ORDER BY next_attempt_at, id
                 LIMIT 10
                 FOR UPDATE SKIP LOCKED)
   AND r.id = m.restaurant_id
RETURNING m.id, m.wa_media_id, m.kind, m.mime_type, m.attempts, m.created_at,
          r.whatsapp_phone_id
```

- **المعاملة بتسكّر قبل التنزيل.** ولا معاملة مفتوحة وقت ما الملف نازل (نت غزة).
- **النتيجة بمعاملة تانية، بحارس:** `… WHERE id = $1 AND state = 'pending' AND attempts = <اللي التقطه>`. عامل قديم رجع بعد ما المهلة خلصت وحدا تاني التقط ← صفر صفوف، وما بيكتب فوقه. **ضابط كسر 4.**
- **النتائج:** `stored` (`content` · `size_bytes` · `width`/`height` للصورة · `finished_at`) · `too_large` (`size_bytes` من ميتا أو من العدّ، بلا محتوى) · فشل ← `next_attempt_at = now() + [30, 120, 600, 3600, 21600] ث` حسب `attempts`، وبعد السادسة `failed` · **عمره > 7 أيام ← `failed` بلا طلب لميتا** · المطعم بلا `whatsapp_phone_id` ← `failed` وسطر `error`.
- **المهلة 120 ث > 10 ث (المعلومات) + 60 ث (التنزيل) + هامش.** ثوابت بالكود، واختبار بيمسك المتراجحة.

### 7.3 التنزيل (`MetaMediaDownloader`، شكل `MetaWhatsAppSender`)
1. `GET {WHATSAPP_GRAPH_API_BASE}/{WHATSAPP_GRAPH_API_VERSION}/{wa_media_id}?phone_number_id={whatsapp_phone_id}` و`authorization: Bearer …`، مهلة `WHATSAPP_SEND_TIMEOUT_MS` ← `{ url, mime_type, file_size }`.
2. `file_size` > `MEDIA_MAX_BYTES` ← `too_large` **بلا تنزيل**.
3. أساس `mime_type` من ميتا **مش بالمسموح لنوعه** (§4.4) ← `failed` (`unsupported`).
4. `GET url` و`authorization: Bearer …`، مهلة 60 ث، **بالقراءة على دفعات وبتوقف أول ما العدّ يتعدّى الحد** ← `too_large`. جواب `content-type` تبعه `text/html` ← فشل (صفحة مش ملف).
5. **ولا سطر سجل فيه الرابط أو التوكن أو البايتات.** السجل: `mediaId` (تبعنا) · `restaurantId` · `kind` · الحجم · النتيجة · `attempts`.
- **الشبكة:** الرابط من ميتا على دومين تاني (`lookaside.fbsbx.com`). سجّل بالتقرير إنه الاستضافة لازم تسمح فيه (لبريف الاستضافة).

### 7.4 الاختبارات (قاعدة حقيقية، **بمحمّل وهمي** بيرجّع بايتات أو أخطاء، و`restaurantScope`)
- الـwebhook: صورة بعد طلب ← صف `pending` بـ`image/jpeg` · صوتية ← `audio` · PDF ← `pdf` و`file_name` · لقطة كملف `image/png` ← `image` · فيديو ← ولا صف · **صورة بلا طلب ← ولا صف** (**ضابط كسر 5**) · صورة وقت سكوت البوت ← صف.
- الطابور: `stored` بالبايتات والأبعاد · `too_large` من `file_size` · `too_large` من العدّ (ميتا قالت 1 KB وبعتت أكتر) · نوع مش مسموح ← `failed` · فشل ← `attempts` 1 و`next_attempt_at` بعد ~30 ث · السادسة ← `failed` · عمره 8 أيام ← `failed` بلا نداء للمحمّل · مطعم بلا رقم ← `failed` · **دورتين بالتوازي (`beforeClaim`) ← تنزيل واحد** · **عامل قديم ← كتابته مرفوضة** · مطعم تاني ما بيتلمس.
- `MetaMediaDownloader` لحاله: **سيرفر `node:http` محلي** (`WHATSAPP_GRAPH_API_BASE` عليه): `Bearer` على الطلبين · `phone_number_id` بالرابط · الوقف عند الحد · `text/html` ← فشل · 404 ← فشل. **ولا طلب لميتا.**

---

## 8. مهأ-6 · الـAPI

### 8.1 الدفع
- `paymentSettled`: `(o.payment_method IN ('cash', 'transfer') OR o.payment_status = 'paid')`. **بلاها، طلب التحويل بيرجع 409 `payment_not_settled` على «اقبل».** **ضابط كسر 3.**
- `extraSets("completed")`: `CASE WHEN o.payment_method IN ('cash', 'transfer') THEN 'collected'::payment_status ELSE o.payment_status END`، وصحّح التعليق.
- `orderListColumns()`/`toListItem`: `paymentMethod` و`paymentStatus` بكل عنصر (`active` و`history` و`returned`).

### 8.2 الإعدادات (`GET`/`PATCH /restaurant/settings`)
- `GET` بيرجّع `paymentMethod` و`transferDetails`.
- `PATCH` (`strictObject` زي اليوم):
  - `paymentMethod`: `"cash"` أو `"transfer"`، غيرهم 400.
  - `transferDetails`: نص أو `null`. **بيتنظّف:** `\r\n` ← `\n` · قصّ الطرفين · محارف التحكّم ممنوعة إلا `\n` (400) · 1–300 حرف · **5 أسطر على الأكثر** · فاضي بعد القصّ = 400.
  - **`transfer` بلا تفاصيل** (لا بالطلب ولا محفوظة) أو **مسحها والمطعم `transfer`** ← 400 بكود `transfer_details_required`. القيد بالقاعدة شبكة أمان، مش بديل (ولا 500).
  - الجواب = الإعدادات بعد التغيير (زي اليوم).
- **مين بيقدر:** نفس صلاحية الإعدادات اليوم. ولا تغيير.

### 8.3 المحادثة (`GET /orders/:id/messages`)
- فرع `inbound`: `LEFT JOIN inbound_media` ← `media` (بلا `content` طبعا) · `caption` = `NULLIF(btrim(COALESCE(i.payload->'image'->>'caption', i.payload->'document'->>'caption')), '')`.
- **القاعدة 2b ما بتتغيّر:** رسالة بلا نص بتطلع بس إذا مربوطة بنفس الطلب.

### 8.4 الملف (`GET /orders/:id/media/:mediaId`) — جديد
- الطلب لازم يكون طلب المسار، والوسيط لرسالة **مربوطة بنفس الطلب**، و`state = 'stored'`. غير هيك (ومطعم تاني بالـRLS) ← **404 بكود `media_not_found`**. `ParseUUIDPipe` على الاتنين. **ضابط كسر 6:** بلا شرط الطلب ← بيسقط «وسيط طلب تاني 404».
- **الرؤوس:** `Content-Type` = `mime_type` المخزّن · `Content-Length` · `Cache-Control: private, max-age=86400` · `X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · `Content-Disposition`: `inline` للصورة والصوت، والـPDF `inline` مع `filename` (اسم إنجليزي `order-<رقم الطلب>.pdf`) و`filename*=UTF-8''…` من `file_name` بعد تنظيفه (بلا `/` `\` `"` ولا أسطر).
- **الدور `sufria_dashboard` بيقرأ بس** (0021). ولا كتابة من هالمسار.

### 8.5 الاختبارات (Jest)
`accepted` و`completed` لطلب تحويل ← 200 و`collected` · أونلاين مش مدفوع ← 409 زي اليوم · الإعدادات: كل حالة بـ§8.2 بكودها · القائمة فيها `paymentMethod`/`paymentStatus` · المحادثة: صورة مخزّنة بأبعادها وتعليقها · `pending` · `too_large` · بلا وسيط ← `media: null` · الملف: 200 بالبايتات والرؤوس كلها · `pending` ← 404 · طلب تاني ← 404 · مطعم تاني ← 404 · PDF باسم فيه `"` و`/` ← اسم نظيف.

---

## 9. مهأ-7 · البوابة الأمنية (`tests/security/chain-isolation.sql`)

| | |
|---|---|
| **A20** | `app.restaurants_with_pending_media()`: اللوحة ← ممنوع · PUBLIC ← ممنوع · المحرّك ← مسموح · `SECURITY DEFINER` · `search_path` مثبّت (نسخة A16) |
| **A21** | مطعم بلا وسيط مستحق، أو `suspended`، ما بيطلع (نسخة A17) |
| **A22** | التابع ما بيرجّع إشي من الوسيط: النتيجة `SETOF uuid` (نسخة A18) |
| **A23** | `inbound_media` معزول: اللوحة بسياق A بتشوف وسائط A بس · `INSERT`/`UPDATE`/`DELETE` من اللوحة ← `permission denied` · صف لرسالة مطعم تاني ← مرفوض |

- **البوابة بتصير 23 + 4.** الضوابط السلبية الأربعة (`negative-controls.sh`) ما بتتغيّر.
- **ضابط كسر 7:** `GRANT UPDATE … TO sufria_dashboard` ← بيسقط A23 بس.

---

## 10. مهأ-8 · سكربتين للاب (شكل `demo-staff-message.mjs`: عبر الـAPI، سطر واحد، ممنوع بالـproduction)

- **`scripts/demo-payment.mjs`:** `show` ← `OK cash` أو `OK transfer · <عدد الأحرف> chars` · `cash` · `transfer "<التفاصيل>"` ← `PATCH /restaurant/settings`. **ما بيطبع التفاصيل** (عدد الأحرف بس). الفشل `FAIL <code> <reason>`.
- **`scripts/demo-media.mjs <رقم الطلب> [--save]`:** المحادثة ← سطر لكل وسيط: `image stored 183 KB 1080×1920 caption:yes` · `audio pending` · `pdf too_large 9.1 MB`. مع `--save`: المخزّن بينزل لـ`<os.tmpdir()>/sufria-media-<رقم الطلب>/` وبيطبع المجلد. **ما بيطبع التعليق نفسه.** يدوّر على الرقم بـ`active` وبعدها أول صفحة من `history`.
- `CLAUDE.md` *Commands*: سطرين.

---

## 11. الاختبارات القائمة · ضوابط الكسر

### 11.1 🔴 اختبارات بتحرس قرار «مش هلق» وبيتغيّر (درس 16) — اكتب كل واحد بالتقرير: شو كان، شو صار، ليش

| الاختبار | اليوم | بعد البريف |
|---|---|---|
| `shared/test/status-notification.test.mts` «🔴 preparing ← صمت» | `statusNotificationAr` صامتة | **بيضل زي ما هو** (`statusNotificationAr` ما تغيّرت، §4.3). القرار الجديد بملف اختبار جديد |
| `dashboard-web/test/shared/status-labels.test.mts` «preparing و completed بلا رسالة زبون — بقصد» | ما في مفتاح `preparing` بـ`ORDER_STATUS_MESSAGE_AR` | **التأكيد بيضل** (ن3 من `RELAY_STATUS_LINE_AR`). **رسالة الاختبار وتعليق `ORDER_STATUS_MESSAGE_AR` بـ`domain.ts` بيتعدّلوا** لذكر القرار المكتوب: ن3 لطلب التحويل بس (قرار محمد 20 أكتوبر، بريف م-هـ-أ) |
| `conversation-engine/test/notifier.test.ts` اختبار 13 (`preparing` صامت) | طلب `preparing` و`notified = false` ← 0 رسائل | **الصف بيتبنى بـ`accepted_notice_at` معبّى** (القبول انبعت قبل)، والتوقّع بيضل. وأي اختبار تاني بيبني `preparing`/`accepted` و`notified = false`: افحص التوقّع، واكتبه |
| اختبارات بتقارن كائن كامل (`toEqual`) للإعدادات · عنصر القائمة · رسالة المحادثة · `buildOrderSummary` | — | بتكبر **بالشكل بس** (حقول جديدة، باراميتر `"cash"`). المعنى ما بيتغيّر. اكتبهم بالعدد |
| `tests/db` أي فحص باسم `orders_collected_is_cash` أو بمرآة enum | — | الاسم والقيم الجديدة |

**أي اختبار تاني بدّه تعديل بالمعنى ← 🛑** اكتب أي واحد وليش.

### 11.2 ضوابط الكسر (المتوقع بملف قبل التشغيل)
1. `accepted_noticed_before` من `RETURNING` ← 6.2 #2 و#6.
2. الإشعار ما بيتعلّم بالالتقاط ← 6.2 #3.
3. `paymentSettled` كاش بس ← «اقبل» طلب تحويل.
4. التخزين بلا حارس `attempts` ← «عامل قديم».
5. صف وسيط لرسالة مش مربوطة ← «صورة بلا طلب».
6. الملف بلا شرط الطلب ← «وسيط طلب تاني».
7. `UPDATE` للوحة على `inbound_media` ← A23.
8. بلا `REVOKE` بالهجرة ← `test:db` «اللوحة ما بتكتب».
9. `renderSummary` بيتجاهل الدفع ← «الملخّص فيه ن1».

---

## 12. مهأ-9 · الحجم والوثائق

- **`check:budget` بالآخر:** **ولا صفحة بتزيد أكتر من 100 بايت** (ما في شاشة). أكتر ← 🛑، والفحص قبل الوقفة: `chunks` الصفحة قبل وبعد، والضغط مع بعض (تقسيم Turbopack؟)، وإذا السبب نص جديد دخل حزمة اللوحة من `domain.ts`. **`perf-budget.json` ما بيتغيّر.**
- **`CLAUDE.md`:** *Layout* (المحرّك: الوسائط والطابور؛ الـAPI: الملف والإعدادات) · *Commands* (السكربتين) · *Database names*: 0020/0021 وليش ملفين، `inbound_media`، Bypass #6 · Tests (الملفات الجديدة والكسرات) · *Known gaps* (§15).
- **`docs/13` §9:** الإعدادات · القائمة · المحادثة · **§9.13 الملف** (المسار، الـ404، الرؤوس).
- **`.env.example`:** `MEDIA_POLL_MS=2000`.
- **مش ملف البريف:** «كما انبنى» بالتقرير.

---

## 13. سيناريوهات اللاب (محمد، بعد المراجعة — **مش هلق**. خطواتها بالمراجعة)

| # | السيناريو | المتوقع |
|---|---|---|
| 1 | مطعم كاش · طلب · «اقبل» و«ابدأ التحضير» ورا بعض بسرعة | **«أكّدنا طلبك رقم N.» بتوصل** (كانت بتضيع) |
| 2 | `demo-payment.mjs transfer "جوال باي 059XXXXXXX (عرض تجريبي)"` · طلب جديد | الملخّص فيه ن1 |
| 3 | «اقبل» (طلب استلام) | ن2 بالمجموع و«شيكل» والتفاصيل |
| 4 | الزبون بيبعت لقطة بتعليق | رد الـrelay زي اليوم · `demo-media.mjs N` ← `image stored … caption:yes` · `--save` والصورة بتنفتح |
| 5 | «ابدأ التحضير» | ن3 |
| 6 | طلب تحويل تاني: «اقبل» و«ابدأ» بسرعة | **ن2**، مش ن3 |
| 7 | صوتية من الزبون | `audio stored` · بتشتغل على اللاب |
| 8 | PDF من الزبون | `pdf stored` · بينفتح |
| 9 | «جاهز» ثم «تم» لطلب تحويل | `collected` · التفاصيل «محصَّل» |
| 10 | صورة لرقم البوت بلا طلب | ولا وسيط |
| 11 | `demo-payment.mjs cash` · طلب | «الدفع نقدا.» |

---

## 14. التقرير

1. جدول مهأ-0.
2. الكوميتات (`mha-<رقم>`)، والكاتب بكل واحد (`git log --format='%h %an %s' origin/main..HEAD`)، وتأكيد: `git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by\|claude-session'` = `0`.
3. الاختبارات قبل وبعد لكل حزمة · `verify` = 0 · `test:db` · البوابة (23 + 4) · `check:budget` لكل صفحة.
4. **§11.1 بالاسم:** كل اختبار قائم تغيّر، شو وليش.
5. ضوابط الكسر: المتوقع مقابل اللي صار.
6. **نصوص البوت كما بتطلع** من مخرج الاختبارات: الملخّص بن1 (استلام وتوصيل) · ن2 (استلام · توصيل · د.أ) · ن3 · جدول §4.3.
7. قرارات أثناء التنفيذ · **الشبكة للاستضافة** (§7.3) · أي فرق بجواب ميتا عن المتوقع.
8. «كما انبنى»: الفرق عن البريف، بالقسم.
9. ما لم يُبنَ وما انتحقق منه (§15 + أي إشي جديد).
10. آخر شي، **حرفيا:** `git status --short && git log --oneline -12`، وآخر 15 سطر من `verify`.

**خطوات اللاب: لا تكتبها.** محمد بياخدها من المراجعة (ومعها النسخة الاحتياطية و`db:migrate` لقاعدة العرض: ملفين).

**الفرع:** `feat/media-transfer` · مرفوع · **لا PR ولا دمج.**

---

## 15. خارج هذه المهمة — وحدود مقبولة (بتنكتب بـ*Known gaps*)

- **الشاشة كلها** (م-هـ-ب، بعد جولة تصميم): عرض الصورة والصوت والـPDF · شارة الدفع · نص زر «ابدأ التحضير» لطلب التحويل. لحدها اللوحة بتكتب «صورة — لا تظهر هنا» زي اليوم.
- **شاشة الإعدادات:** طريقة الدفع بالسكربت لحدها.
- **حذف الوسائط بعد مدة** (معلومات مالية للزبون) · **إلغاء أوتوماتيكي لطلب ما انحوّل** · **ربط وسيط انبعت قبل «أكّد» بالطلب** — بالمؤجلات.
- **صوتية بنص السلّة:** «غير مفهوم» زي اليوم، وما بتوصل للموظف.
- **وسائط قبل 0021:** رسائل مربوطة من قبل بتضل بلا ملف (ولا تنزيل رجعي).
- **«اقبل» و«ابدأ» و«جاهز» كلهم بأقل من 5 ث:** بتوصل «جاهز» بس.
- **زبون حوّل قبل القبول** بتوصله ن2 «حوّل» (ممكن يحوّل مرتين، نادر) · **إلغاء بعد التحويل:** الاسترجاع بالإيد · **زبون دفع كاش بمطعم تحويل:** الطلب بيتسجّل تحويل.
- **صوتيات واتساب (Opus) على iOS أقدم من 18.4:** مش مضمونة (للشاشة).
- ولا: الفيديو · ملفات غير PDF · صور مصغّرة · `refunded` · بوابة دفع · إرسال وسائط من الموظف · فهم الصوت.
