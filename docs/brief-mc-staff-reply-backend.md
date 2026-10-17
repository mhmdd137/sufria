# بريف المهمة م-ج — الموظف بيكتب للزبون من اللوحة: المحرّك والـAPI

**Sufria · 17 أكتوبر 2026 · لكلود كود (جلسة لوكال على لاب محمد، effort high) · فرع جديد `feat/staff-reply` من `origin/main` (`70c0bc5` + كوميت البريف)**

**البريف على `main`:** `docs/brief-mc-staff-reply-backend.md` (`git fetch origin && git show origin/main:docs/brief-mc-staff-reply-backend.md`). **لا تنسخه للفرع ولا تعدّله.** «كما انبنى» بالتقرير بس (§10).

**النطاق:**
- **هجرة 0018:** جدول `staff_messages` · عمود `customers.bot_resumed_at` · دالة `app.bot_silence` · دالة `app.restaurants_with_pending_staff_messages`.
- **الـAPI:** الموظف بيكتب لزبون الطلب · «رجّع للبوت» · رسائل الموظف بمحادثة الطلب، ومعها سكوت البوت ومهلة الرد · وقت آخر رسالة موظف على عنصر قائمة الطلبات.
- **المحرّك:** البوت بيسكت للزبون اللي الموظف بيحكي معه · طابور بيبعت رسائل الموظف.
- **`packages/shared`:** الأنواع والـschema.
- **سكربت تطوير** `scripts/demo-staff-message.mjs`: بديل الشاشة بالتجربة.
- **`dashboard-web`: ولا سطر كود** (إلا فيكسترز الاختبارات، §0). الشاشة كلها ببريف م-د.

**نقطة التوقف:**
- مج-0 الفحص · مج-1 الهجرة والأمان · مج-2 shared · مج-3 الـAPI · مج-4 سكوت البوت · مج-5 الطابور · مج-6 السكربت · مج-7 الوثائق.
- كوميت بعد كل بند، واختبار الحزمة اللي انلمست. `verify` الكامل مرة بالآخر، و`check:budget` (§0ب).
- الفرع مرفوع، وبعده تقرير. **بلا PR وبلا دمج.**

**يُقرأ مع (بالقسم، §0ب):**
- `CLAUDE.md`: شروط الإنجاز · Tests · *Known gaps* (بند `order_placed is a closed state` والرسالة بعد الطلب).
- `docs/brief-ma-customer-messages.md` §4 و«كما انبنى»: الربط بـ`relayed.orderId`، وقاعدة الرسالة بعد الطلب.
- `docs/15-notifications-brief.md` §1: الالتقاط الذرّي و«مرة على الأكثر». الطابور بيمشي عليهم.
- `db/migrations/0012_restaurants_with_unnotified_orders.sql` و`tests/security/chain-isolation.sql` (A13–A15).
- `scripts/demo-order-status.mjs`.

> **البريف يقول المطلوب، والريبو يقول الواقع.** عند التعارض: قف واكتب وين اختلف.
>
> **محمد بيراجع بالآخر.** لا تقف إلا عند شرط 🛑. غير هيك: القرار الأبسط الموافق للبريف، وسجّله تحت «قرارات أثناء التنفيذ».

---

## ليش

**القصة:** أحمد طلب شاورما، وبعد شوي كتب «بدون بصل لو سمحت». من م-ب، الموظف بيشوف الرسالة على البطاقة وبيسمع نقرة. بس ليرد، لازم يضغط «راسل الزبون»، فبيفتح واتساب من رقم المطعم، وأحمد بيستلم الرد من رقم غير اللي طلب منه. ولو أحمد رد على رقم البوت، البوت هو اللي بيرد عليه بسطر الحالة، مش الموظف.

**بعد م-ج وم-د:** الموظف بيكتب بصفحة الطلب، والرسالة بتطلع من رقم البوت بنفس المحادثة، والبوت بيسكت لأحمد لحد ما يرجع بالوقت الصح.

**هاد البريف الباك بس، وآمن لحاله:** بلا الشاشة ما حدا بيقدر يكتب لزبون (إلا سكربت التطوير على اللاب)، فالبوت ما بيسكت لحدا، والطابور بيدوّر كل 5 ث وما بيلاقي إشي.

---

## قرارات محمد — مقفولة (13 و17 أكتوبر)

| # | القرار |
|---|---|
| 1 | **أول رسالة من الموظف بتسكّت البوت لهالزبون.** البوت بيرجع بأول وحدة من هدول: زر «رجّع للبوت» · **60 دقيقة من آخر رسالة للموظف** (مش من أولها) · الزبون كتب «منيو» · **طلب الرسالة صار مكتمل أو ملغى أو غير مستلَم** |
| 2 | **رسالة موظف بعد إغلاق الطلب بتسكّت البوت من جديد** (شكوى بعد الاستلام مثلا) |
| 3 | **السكوت بيغلب كل شي إلا التفاعل:** جلسة طلب شغّالة · بوابة الدوام · إيقاف الطلبات · قاعدة م-أ. زبون بنص سلّة والموظف كتبله: رده بيروح للموظف، والسلّة بتستنى. إذا طال السكوت أكتر من مهلة الجلسة، الجلسة بتخلص زي اليوم |
| 4 | **وقت السكوت، رسالة الزبون بتنربط بطلب رسالة الموظف، وما في رد من البوت.** (هيك بتطلع على البطاقة وبترن، بكود م-ب زي ما هو) |
| 5 | **رسالة الموظف بتوصل زي ما كتبها**، بلا أي نص منا قبلها أو بعدها |
| 6 | **المحرّك هو اللي بيبعت، بطابور كل 5 ث.** الـAPI بيكتب الصف وبس |
| 7 | **السكوت بيبلّش لحظة ما الموظف يضغط** (لما الصف ينكتب)، مش لما الرسالة تطلع. هيك ما بيطلع سطر بوت بالثواني اللي بيناتهم |
| 8 | **فشل الإرسال: محاولتين كمان (بعد 2 ث و6 ث)، وبعدين «فشلت»،** والموظف بيعيد بإيده. **مرة على الأكثر**، زي الإشعارات: رسالة مكرّرة أسوأ من ضايعة. رفض ميتا للـ24 ساعة (`131047`) ما بينعاد |
| 9 | **رسالة استنّت أكتر من دقيقتين قبل ما يبلّش إرسالها ما بتنبعت أبدا**، وبتصير «فشلت». (النفق وقع، والموظف كتب «طلبك بعد 10 دقايق»، والمحرّك رجع بعد 40 دقيقة: الرسالة ما لازم تطلع) |
| 10 | **رسالة فشلت ما بتسكّت البوت.** السكوت بيرجع زي ما عملته الرسالة اللي قبلها |
| 11 | **إشعارات الحالة («أكّدنا طلبك…») بتضل توصل وقت السكوت.** المُراقِب ما بينلمس |
| 12 | **الـ24 ساعة من آخر رسالة من الزبون، بلا التفاعل، بهامش 10 دقايق:** الكتابة مسموحة لحد 23 ساعة و50 دقيقة بعدها |
| 13 | **بينحفظ مين بعت** (`staff_account_id`)، **ورقم ميتا للرسالة** (`wa_message_id`) |
| 14 | **عنصر قائمة الطلبات بياخد وقت آخر رسالة موظف ما فشلت** (`staffMessagedAt`). الشاشة (م-د) بتوقف فيه رنين الطلب المعلّق |

### النصوص

**ولا نص عربي جديد بهالبريف.** البوت ما بيبعت إشي جديد للزبون، بس بيسكت، ونص الموظف هو كلامه. أي نص عربي للزبون أو للموظف ← 🛑. رسائل أخطاء الـAPI إنجليزي للمطوّر (`message`)، والشاشة بتقرأ `code` (D §8.7).

### قرارات البريف (من Claude، بتمشي إلا إذا الريبو بيقول غير)

- **قاعدة السكوت بمكان واحد:** `app.bot_silence(customer_id)` بالهجرة (§2). المحرّك والـAPI بيقروها، **وما في نسخة TS منها.** ليش: تطبيقين لازم يتفقوا عليها حرفيا، وكل وقت فيها بساعة القاعدة.
- **السكوت محسوب، مش حالة مخزّنة:** آخر رسالة موظف ما فشلت · `silence_until` تبعها · `customers.bot_resumed_at` · سجل الحالات. هيك قرار 10 بيصير لحاله، وما في علم سكوت بيتنسى مضوي.
- **`silence_until` بيكتبه الـAPI وقت الإدخال:** `now() + make_interval(mins => BOT_SILENCE_MINUTES)`. المتغيّر بالـAPI بس، فالتجربة بتغيّره بمكان واحد.
- **رسالة الموظف بـ`staff_messages` لحالها، مش بـ`outbound_messages`:** الطابور بيبعت بالمرسِل الخام (`MetaWhatsAppSender`)، مش بـ`SavingWhatsAppSender`. المحادثة بتعرضها مرة وحدة، بحالتها.
- **`clientId` من الشاشة:** ضغطتين، أو طلب انعاد بعد انقطاع النت، بيلاقوا نفس الصف.
- **النص بينحفظ زي ما انكتب**، بعد قص الفراغات من الطرفين بس. **ولا تحويل أرقام** (`toWesternDigits` للأسعار، مش لكلام الموظف).
- **السباق بين رسالة الزبون وضغطة الموظف بنفس اللحظة مقبول بلا قفل:** أسوأ شي سطر بوت واحد قبل رسالة الموظف بثواني.
- **الطابور على نمط `OrderNotifier`:** قائمة مطاعم من دالة SECURITY DEFINER، والتقاط ذرّي لكل رسالة (`UPDATE … WHERE send_state = 'pending' RETURNING`) بمعاملة بتتقفل قبل الإرسال، ودورة ما بتتداخل مع دورة.
- **`MetaWhatsAppSender` بيرجّع رقم ميتا** (`messages[0].id` من الرد) **بأصغر تغيير:** ولا نداء قائم ولا fake قائم بيتعدّل (مثلا: الواجهة بترجّع `Promise<SentText | void>`). شكل التغيير بالتقرير.
- **`sending` عالقة** (العملية ماتت بنص الإرسال) بتصير «فشلت» بعد نفس الدقيقتين، من وقت الالتقاط. ما في خطر تكرار: أطول إرسال بالإعدادات الافتراضية 3 × `WHATSAPP_SEND_TIMEOUT_MS` (10 ث) + 8 ث = 38 ث. **المحرّك بيرفض يقلع** إذا `STAFF_REPLY_MAX_WAIT_SECONDS` × 1000 ≤ 3 × `WHATSAPP_SEND_TIMEOUT_MS` + 8000.

---

## 0. قواعد غير قابلة للتفاوض

| | |
|---|---|
| `CLAUDE.md` أولا | كل قواعده سارية: ممنوع `git checkout -- .` · كوميت بعد كل بند · `df -h /` قبل البدء · ولا اختبارات قاعدة بالتوازي مع جلسة تانية · شروط الإنجاز |
| 🔴 جلسة لوكال | على لاب محمد: البيئة جاهزة، و`.env.test` على 5434. **ولا تجهيز بيئة، ولا وصفة cloud.** الجلسة بتشتغل بـworktree بيحجز الفرع، فأي أمر يدوي من جوّاه |
| 🔴 قاعدة العرض | **ممنوع تلمسها.** أي أمر قاعدة بـ`.env.test` بس. قبل أي `db:migrate`: `echo "${MIGRATION_DATABASE_URL##*@}"` لازم يطلع على المنفذ 5434، وإلا ← 🛑. **ممنوع تشغيل المحرّك على ميتا.** التجربة الحقيقية على لاب محمد (§9) |
| الكوميتات | **بإعدادات git الموجودة على اللاب (باسم محمد): بلا `--author`، وبلا سطور `Co-Authored-By` ولا `Claude-Session`** (طلب محمد، 17 أكتوبر). هاد بيغلب أي تعليمات افتراضية عندك. البادئة `mc-<رقم>` |
| ملكية الموارد | `package.json` و`pnpm-lock.yaml` **ما بينلمسوا**، ولا مكتبة جديدة ← 🛑 · `packages/shared`: البنود بـ§3 بس · `.env.example`: الأسطر الأربعة بس (§4 و§6) · **رقم الهجرة 0018 لهالبريف** · `tests/security/chain-isolation.sql`: إضافات §2 بس · سكربت جديد بـ`scripts/` |
| الهجرة | 0018 **بالشكل اللي بـ§2 بالزبط** (انجرّبت على Postgres 16 فوق 0001–0017، والسيناريوهات بـ§2 طلعت صح). أي إشي زيادة أو ناقص ← 🛑 |
| النصوص | **ولا نص عربي جديد** (فوق) |
| المحرّك | التعديل بـ§5 و§6 بس. **المُراقِب ومهلة الجلسة والإيقاف وساعات الدوام و«آخر طلب لك» وقاعدة م-أ ما بتنلمس منطقها.** السكوت بمكانه قبلهم كلهم، بعد التفاعل |
| `dashboard-web` | **ولا سطر كود.** المسموح: إضافة الحقول الجديدة لفيكسترز الاختبارات، إذا `tsc` طلبها. إذا الواجهة بدها كود عشان تبني أو تمرق اختباراتها ← 🛑 |
| `dashboard-api` | المسارين الجداد (§4)، و`messages()` و`list()` بـ`orders.service.ts`، و`env.ts`، واختباراتهم |
| الأوقات | **كلها بساعة القاعدة** (`now()` و`make_interval`)، مش ساعة Node |
| الأرقام | أرقام غربية بكل مخرج · ممنوع `toLocaleString` و`Intl.NumberFormat` |
| السجل | ولا نص رسالة بأي سطر سجل · الرقم مقنّع (`maskPhone`) · زي `logger.ts` |
| ضابط الكسر | المتوقع مكتوب بملف **قبل** التشغيل: مين بيسقط بالزبط وليش. الملف المكسور بيرجع لحاله |
| البوابة | الاختبارات بـ`.env.test` بس. `verify` الكامل = 0 على آخر كوميت (§0ب) |

## 0ب. 🔴 قواعد التكلفة (قرار محمد، 14 أكتوبر)

1. **effort high.** (فيه تزامن، بس محمد قرّر high: الأنماط موجودة بالريبو، والأقفال بتنراجع على الريبو بعد التقرير.)
2. **ناتج أي أمر طويل على ملف** (`> /tmp/mc-verify.log 2>&1`)، والكونتكست بياخد آخر 20 سطر بس. نفس الشي لـ`check:budget` والبناء.
3. **بعد كل كوميت: اختبار الحزمة اللي انلمست بس.** `verify` الكامل مرة بالآخر، على آخر كوميت.
4. **الوثائق بالقسم:** `grep -n` للعنوان، وبعدها `sed -n` للأسطر. **ممنوع قراءة `docs/11` و`docs/12` و`docs/13` كاملة.**
5. **أي إصلاح بعد التقرير بجلسة جديدة** ببرومبت قصير، مش بنفس الجلسة.
6. محمد ما بيغيب أكتر من ساعة بالنص، إذا بدّه يكمّل بنفس الجلسة.

---

## 1. مج-0 · افحص قبل أي كود — جدول أول التقرير، ثم تابع

| # | الفحص | 🛑 |
|---|---|---|
| 1 | `df -h /` · `git log --oneline -3 origin/main` (آخره كوميت البريف فوق `70c0bc5`) · `verify` على الكوميت الأساس = 0، بالأرقام. المتوقع: shared 246 · web 192 · المحرّك 282 · الـAPI 383 · `test:db` 6 · البوابة 15 + 4 · التباين 54 زوج | إذا مش 0 |
| 2 | آخر هجرة `0017_customer_messages_seen.sql`، وما في `0018` | إذا في |
| 3 | ترتيب `handleInbound` بالأسطر: التفاعل ← قراءة المطعم ← الجلسة النشطة ← المهلة ← الإيقاف ← المعالجات ← قاعدة م-أ ← بوابة الدوام ← … **السكوت رح يكون بعد التفاعل وقبل قراءة المطعم** | إذا الترتيب غير هيك |
| 4 | الـwebhook بيكتب `relayed.orderId` على صف الرسالة الواردة بنفس المعاملة (م-أ). السكوت رح يستعمل نفس الخانة | إذا لأ |
| 5 | `OrderNotifier`: القائمة بـ`runUnscoped` · الالتقاط لكل صف · الإعادات · حارس التداخل · `restaurantScope` و`beforeClaim` للاختبارات. شو رح تنسخ للطابور | — |
| 6 | `main.ts`: كيف المرسِل الخام بيوصل للطابور بلا الـsaving wrapper · ترتيب الإيقاف (الطابور قبل المخزن، زي المُراقِب) | — |
| 7 | كل مكان بينفّذ `WhatsAppSender` (المعروف: Meta · Recording · Saving · `FailingFor` بـ`notifier.test.ts` · `FailingSender` بـ`customer-relay.test.ts`)، وأصغر تغيير بيرجّع رقم ميتا | إذا التغيير بيلمس fake أو نداء قائم |
| 8 | `dashboard-web`: وين بينقرأ `direction` (المعروف: `features/orders/lib/details.ts` 171 · 177 · 193 · 219 · 236). رسالة `staff` رح تبين زي رد البوت لحد م-د، وما بتعمل رنّة. والفيكسترز اللي `tsc` رح يطلب فيها الحقول الجديدة، بالأسماء | إذا لازم كود بالواجهة |
| 9 | الـAPI: `VerifiedRestaurantId` · `CurrentUser().staffAccountId` · نمط الـDTO والتحقق · `conflict()` · `whatsappTextLength` و`WHATSAPP_TEXT_LIMIT` بـshared · بنية `messages()` (الـCTE والـ`UNION ALL` والـ`LIMIT`) | — |
| 10 | `sufria_dashboard` بيقرأ `staff_accounts.name` (للاسم بالمحادثة) | إذا لأ |
| 11 | `scripts/demo-order-status.mjs`: الدخول من `DEMO_STAFF_EMAIL/PASSWORD` بلا طباعة، ودوّرانه على الطلب بالرقم | — |
| 12 | `tests/security/chain-isolation.sql` (A13–A15) وكيف البوابة بتعدّ (15 + 4) · `tests/db/schema-drift.verify.ts` شو بيقارن · `tests/db/migrate.test.mjs` إذا بيعدّ الهجرات | — |
| 13 | `setup-env.ts` بالمحرّك وبالـAPI: وين بتتثبّت المتغيّرات للاختبارات | — |

**اكتب النتائج أول التقرير، وتابع بلا انتظار** (إلا عند 🛑).

---

## 2. مج-1 · الهجرة 0018 والأمان

**الهجرة حرفيا** (`db/migrations/0018_staff_messages.sql`، بتعليقاتها):

```sql
-- =============================================================================
-- 0018: brief م-ج — the restaurant writes to its customer from the dashboard.
--
-- staff_messages: every text a staff member sent to an order's customer, from
-- the moment they pressed «send». The dashboard writes the row
-- (send_state 'pending'); the Conversation Engine sends it on its own timer
-- and moves it forward: pending → sending → sent | failed. Never backwards,
-- never deleted by the application.
--
-- Not in outbound_messages (0013): a staff text lives here alone — with its
-- state, its author and Meta's id — so the order's conversation shows it
-- once. The engine sends it through its raw sender, not the saving wrapper.
--
-- The bot keeps quiet for a customer while their latest staff message that
-- did not fail is younger than its silence_until (written by the dashboard,
-- on the database's clock), unless, after that message:
--   - the customer wrote «منيو», or staff pressed «رجّع للبوت» —
--     customers.bot_resumed_at;
--   - or the message's order was completed, cancelled or expired —
--     its order_status_history row.
-- app.bot_silence() is that rule, in one place, for the engine and the
-- dashboard alike. A failed message never silences: the silence goes back to
-- what the previous message made it, with nothing to undo.
-- =============================================================================

BEGIN;

CREATE TABLE staff_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL,
  -- Who pressed «send». NULL only once the account is gone.
  staff_account_id uuid NULL REFERENCES staff_accounts(id) ON DELETE SET NULL,
  -- The screen's own id for this message: a second press, or a request sent
  -- again, finds the first row instead of sending twice.
  client_id        uuid NOT NULL,
  body             text NOT NULL CHECK (btrim(body) <> ''),
  send_state       text NOT NULL DEFAULT 'pending'
                   CHECK (send_state IN ('pending', 'sending', 'sent', 'failed')),
  failure          text NULL
                   CHECK (failure IN ('expired', 'send_failed', 'window_closed', 'no_sender_number')),
  -- Meta's error code when Meta refused the send (131047: the 24 hours).
  meta_error_code  integer NULL,
  -- Meta's id for the sent message (wamid.*): what a delivery status names,
  -- when the dashboard shows one.
  wa_message_id    text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The end of the bot's silence this message makes: created_at plus
  -- BOT_SILENCE_MINUTES, written by the dashboard.
  silence_until    timestamptz NOT NULL,
  claimed_at       timestamptz NULL,
  finished_at      timestamptz NULL,

  -- The tenant key of 0013: another restaurant's order cannot be named here.
  FOREIGN KEY (order_id, restaurant_id)
    REFERENCES orders (id, restaurant_id) ON DELETE CASCADE,
  UNIQUE (restaurant_id, client_id),
  CHECK (silence_until > created_at),
  CHECK ((send_state = 'failed') = (failure IS NOT NULL))
);

-- An order's staff messages in time order — the conversation's read, and the
-- silence's (through orders.customer_id).
CREATE INDEX idx_staff_messages_order
  ON staff_messages (order_id, created_at);

-- The engine's queue: only what waits or is being sent.
CREATE INDEX idx_staff_messages_queue
  ON staff_messages (restaurant_id, created_at)
  WHERE send_state IN ('pending', 'sending');

-- -----------------------------------------------------------------------------
-- RLS. The shape of 0006 and 0013, verbatim.
-- -----------------------------------------------------------------------------
ALTER TABLE staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_messages
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_messages TO sufria_dashboard, sufria_engine;

-- -----------------------------------------------------------------------------
-- The last time the bot was handed back to this customer: «منيو» from them
-- (the engine) or «رجّع للبوت» on the dashboard. A staff message older than
-- this no longer keeps the bot quiet.
-- -----------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN bot_resumed_at timestamptz NULL;

-- -----------------------------------------------------------------------------
-- app.bot_silence(customer): the order whose staff message keeps the bot
-- quiet, and until when — or no row.
--
-- SECURITY INVOKER (the default) on purpose: it runs under the caller's RLS,
-- so a customer of another restaurant gives no row. Every time is the
-- database's: now(), and the rows' own created_at and changed_at.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.bot_silence(p_customer_id uuid)
  RETURNS TABLE (silenced_order_id uuid, silenced_until timestamptz)
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    WITH last_message AS (
      SELECT s.order_id, s.created_at, s.silence_until
        FROM staff_messages s
        JOIN orders o ON o.id = s.order_id
       WHERE o.customer_id = p_customer_id
         AND s.send_state <> 'failed'
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 1
    )
    SELECT m.order_id, m.silence_until
      FROM last_message m
      JOIN customers c ON c.id = p_customer_id
     WHERE m.silence_until > now()
       AND (c.bot_resumed_at IS NULL OR c.bot_resumed_at < m.created_at)
       AND NOT EXISTS (
             SELECT 1
               FROM order_status_history h
              WHERE h.order_id = m.order_id
                AND h.to_status IN ('completed', 'cancelled', 'expired')
                AND h.changed_at > m.created_at)
  $$;

REVOKE ALL ON FUNCTION app.bot_silence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bot_silence(uuid) TO sufria_dashboard, sufria_engine;

-- -----------------------------------------------------------------------------
-- Bypass #5: which restaurants have a staff message to send. The shape of
-- Bypass #4 (0012), for the same reason: the engine's timer has no inbound
-- message and so no tenant context, and under RLS it reads zero rows. Output:
-- restaurant ids and nothing else; every read and write after it runs under
-- RLS, inside runInTenant. EXECUTE for sufria_engine alone. The pinned
-- search_path is what keeps a caller's schema from shadowing staff_messages.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.restaurants_with_pending_staff_messages()
  RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT s.restaurant_id
      FROM staff_messages s
      JOIN restaurants    r ON r.id = s.restaurant_id
     WHERE s.send_state IN ('pending', 'sending')
       AND r.status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.restaurants_with_pending_staff_messages() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restaurants_with_pending_staff_messages() FROM sufria_dashboard;
GRANT EXECUTE ON FUNCTION app.restaurants_with_pending_staff_messages() TO sufria_engine;

COMMIT;
```

**شو انفحص قبل البريف (Postgres 16، فوق 0001–0017، بدور `sufria_engine` وسياق مطعم):** ولا رسالة ← ولا صف · رسالة `pending` ← صف · الوحيدة `failed` ← ولا صف · الأخيرة `failed` وقبلها `sent` ← صف الأولى · `bot_resumed_at` بعد الرسالة ← ولا صف · رسالة بعد `bot_resumed_at` ← صف · الطلب انلغى بعد الرسالة ← ولا صف · رسالة بعد الإلغاء ← صف · مطعم تاني بنفس الرقم ← ولا صف · دالة الطابور: المحرّك بلا سياق بيشوف المطعم، والـAPI `permission denied` · الـFK بيرفض طلب مطعم تاني · RLS بيرفض صف لمطعم تاني · `body` فراغات ← CHECK · `failed` بلا `failure` ← CHECK · نفس `client_id` مرتين ← UNIQUE.

**`packages/shared/src/schema.ts`:** جدول `staffMessages` وعمود `customers.botResumedAt`، مطابقين للهجرة بالزبط (`schema-drift` بيفحص).

**`tests/security/chain-isolation.sql`:**
- **A16–A18** لـ`app.restaurants_with_pending_staff_messages()`، على شكل A13–A15 بالزبط: الـAPI وPUBLIC ما بيقدروا ينادوها، والمحرّك بيقدر · SECURITY DEFINER · `search_path` مثبّت · مطعم ما عنده رسالة `pending` ولا `sending` ما بيطلع · النتيجة `SETOF uuid` وبس.
- **A19** لـ`app.bot_silence(uuid)`: **مش** SECURITY DEFINER · الدورين بيقدروا ينادوها وPUBLIC لأ · تحت سياق مطعم، زبون مطعم تاني ما بيرجّع صف حتى لو عنده رسالة موظف ساكتة.

**`test:db`:** الهجرة بتطبق، والـschema مطابق. العدد الجديد بالتقرير.

**ضوابط كسر** (`CREATE OR REPLACE` مؤقت على قاعدة الاختبارات، وبعدها ترجيع النسخة اللي بالهجرة، وتأكد بـ`pg_get_functiondef` إنها رجعت حرفيا):

| الكسر | المفروض يسقط |
|---|---|
| `SECURITY DEFINER` على `bot_silence` | A19 |
| `GRANT EXECUTE` لـ`sufria_dashboard` على دالة الطابور | A16 |

---

## 3. مج-2 · `packages/shared`

**`dashboard-api.ts`** (التعليقات بأسلوب الملف):

```ts
/**
 * Who wrote a message of an order's conversation: the customer (`inbound`),
 * the bot (`outbound`) or, from brief م-ج, a staff member (`staff`).
 */
export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "staff"] as const;

/** A staff message as the dashboard sees it: the database's `pending` and
 *  `sending` are both `pending`. */
export const STAFF_MESSAGE_SEND_STATES = ["pending", "sent", "failed"] as const;

/** Why a staff message failed — `staff_messages.failure` (0018). */
export const STAFF_MESSAGE_FAILURES = [
  "expired", "send_failed", "window_closed", "no_sender_number",
] as const;

// OrderMessage becomes a union. The fields of today, with their comments:
type OrderMessageBase = { id; kind; text; location; at };
export type CustomerOrBotMessage = OrderMessageBase & {
  direction: "inbound" | "outbound";
};
export type StaffOrderMessage = OrderMessageBase & {
  direction: "staff";
  kind: "text";
  // `at`: when staff pressed «send» (`created_at`), not when it went out.
  sendState: StaffMessageSendState;
  failure: StaffMessageFailure | null; // with `failed` alone
  staffName: string | null;            // null once the account is gone
  clientId: string;
};
export type OrderMessage = CustomerOrBotMessage | StaffOrderMessage;

export type OrderMessagesResponse = {
  messages: OrderMessage[];
  // The bot keeps quiet for this order's customer, because of a staff message
  // on `orderId` (this order or another of theirs), until `until` (ISO, UTC).
  botSilence: { orderId: string; until: string } | null;
  // The last moment staff can write to this customer: their last message
  // that is not a reaction + REPLY_WINDOW_MINUTES. null once it passed, or
  // with no message at all.
  replyOpenUntil: string | null;
};

export type CreateStaffMessageRequest = { text: string; clientId: string };
export type CreateStaffMessageResponse = StaffOrderMessage;
export type StaffMessageConflictCode = "reply_window_closed" | "client_id_reused";
export type StaffMessageConflictBody = {
  statusCode: 409; error: "Conflict"; code: StaffMessageConflictCode; message: string;
};
```

**`OrderListItem`:** `staffMessagedAt: string | null`: ISO بـUTC، آخر رسالة موظف على هالطلب ما فشلت، و`null` إذا ما في. (الشاشة، م-د، بتوقف فيه رنين الطلب المعلّق: قرار 14.)

**ولا نص عربي.**

---

## 4. مج-3 · الـAPI

**`env.ts` تبع الـAPI:** `BOT_SILENCE_MINUTES` (الافتراضي `60`) و`REPLY_WINDOW_MINUTES` (الافتراضي `1430`، يعني 23 ساعة و50 دقيقة)، بنفس شكل الموجود · `setup-env.ts` بيثبّتهم على الافتراضي · `.env.example` بيذكرهم.

**أ. `POST /orders/:id/messages`:** الموظف بيكتب لزبون الطلب. الفحوصات بالترتيب:
1. **400** (الـDTO): `text` نص، بعد القص من الطرفين مش فاضي، و`whatsappTextLength` ≤ `WHATSAPP_TEXT_LIMIT` · `clientId` UUID.
2. **404:** الطلب مش موجود أو مش إلنا (نفس الـ404).
3. **صف بنفس `clientId` بهالمطعم:**
   - لنفس الطلب ← **200** بالصف زي ما هو (ولا صف جديد، ولا فحص للـ24 ساعة).
   - لطلب تاني ← **409 `client_id_reused`**.
4. **409 `reply_window_closed`:** ما في رسالة من زبون الطلب (`inbound_messages.from_phone` = `customers.phone_number`، و`message_type <> 'reaction'`) خلال `REPLY_WINDOW_MINUTES`.
5. **201:** صف جديد بـ`staff_messages`: `staff_account_id` من التوكن · `body` بعد القص · `silence_until = now() + make_interval(mins => BOT_SILENCE_MINUTES)`. الرد `StaffOrderMessage` (`sendState: "pending"`).
- **ضغطتين بنفس اللحظة بنفس `clientId`:** `INSERT … ON CONFLICT (restaurant_id, client_id) DO NOTHING`، والتانية بتقرأ الصف وبترجع 200.
- **ولا إرسال من الـAPI.**

**ب. `POST /orders/:id/resume-bot`:** «رجّع للبوت». `customers.bot_resumed_at = now()` لزبون الطلب ← **204**. **404** لطلب مش إلنا. بيشتغل حتى لو البوت مش ساكت (ما بيضر).

**ج. `GET /orders/:id/messages`:**
- **رسائل الموظف على هالطلب** بالمحادثة (`direction: "staff"`)، بالترتيب مع الباقي حسب `at` = `created_at`، وجوّا نفس حد الـ200. `pending` و`sending` ← `pending`. `staffName` من `staff_accounts.name` (`LEFT JOIN`).
- **`botSilence`** من `app.bot_silence(o.customer_id)` · **`replyOpenUntil`** = آخر رسالة من الزبون (بلا التفاعل) + `REPLY_WINDOW_MINUTES` إذا لسا ما فات، وإلا `null`.
- **قواعد رسائل الزبون والبوت القائمة ما بتتغيّر.**

**د. `GET /orders`:** `staffMessagedAt` لكل عنصر، بـ`orders` وبـ`returned`.

**الاختبارات** (ملف جديد `test/staff-messages.test.ts` على نمط `customer-messages.test.ts`، والأوقات بـ`UPDATE … = now() - interval`):

| # | الحالة | المتوقع |
|---|---|---|
| 1 | POST عادي | 201 · الصف: الموظف من التوكن · النص مقصوص · `silence_until - created_at` = 60 دقيقة · `pending` · الرد بالشكل |
| 2 | نفس `clientId` لنفس الطلب | 200 · نفس المعرّف · صف واحد |
| 3 | نفسه، بعد ما سكّرت الـ24 ساعة | 200 (مش 409) |
| 4 | نفس `clientId` لطلب تاني | 409 `client_id_reused` |
| 5 | طلبين بنفس اللحظة بنفس `clientId` (على نمط اختبارات السباق القائمة) | صف واحد · 201 و200 |
| 6 | `"   "` · 4097 حرف · `clientId` مش UUID | 400 · و4096 بالزبط ← 201 |
| 7 | طلب مطعم تاني | 404 زي اللي مش موجود · ولا صف |
| 8 | آخر رسالة من الزبون من 1431 دقيقة · ومن 1429 | 409 `reply_window_closed` · 201 |
| 9 | تفاعل من دقيقة، ونص من 1431 | 409 |
| 10 | `resume-bot` · ولطلب مطعم تاني | 204 و`bot_resumed_at` انكتب · 404 |
| 11 | المحادثة: رسالة موظف `pending` ثم `sent` ثم `failed` (بالـ`UPDATE`) | `staff` · `sendState` و`failure` صح · `staffName` · بالترتيب |
| 12 | رسالة موظف على طلب B لنفس الزبون | ما بتطلع بمحادثة A |
| 13 | `botSilence`: قبل · بعد POST · بعد `resume-bot` · بعد إغلاق الطلب (`completed` بالسجل) · بعد POST جديد على الطلب الخالص · والوحيدة `failed` | `null` · `{orderId, until}` · `null` · `null` · مش `null` · `null` |
| 14 | `replyOpenUntil`: عادي · فات · ولا رسالة | آخر رسالة + النافذة · `null` · `null` |
| 15 | `staffMessagedAt` بالقائمة: قبل · بعد POST · الوحيدة `failed` · طلب بـ`returned` | `null` · الوقت · `null` · موجود |
| 16 | كل الاختبارات القائمة | بتمرق بلا تعديل |

**ضوابط كسر:**

| الكسر | المفروض يسقط |
|---|---|
| فحص الـ24 ساعة قبل فحص `clientId` | 3 |
| بلا استثناء التفاعل بفحص الـ24 ساعة | 9 |
| رسائل الموظف بكل محادثات الزبون (مش طلبها بس) | 12 |
| `silence_until` بساعة Node | اختبار حد تعمله إنت، على نمط اختبار 9 بح |

---

## 5. مج-4 · المحرّك: البوت بيسكت

**مكانه:** بـ`handleInbound`، **بعد التفاعل مباشرة وقبل قراءة المطعم** (مج-0 #3). ملف لحاله، مثلا `src/conversation/bot-silence.ts`: غلاف I/O رفيع، والقاعدة نفسها بالدالة (§2).

1. **الاستعلام** (جوّا معاملة الرسالة، تحت RLS المطعم): الزبون بالرقم، و`app.bot_silence(customer.id)`. ولا زبون أو ولا صف ← **كمّل زي اليوم بالزبط.**
2. **في سكوت والرسالة «منيو»** (`matchCommand(body ?? "") === "menu"`): `customers.bot_resumed_at = now()`، **وكمّل زي اليوم بالزبط** (جلسة شغّالة بتاخدها، وإلا طلب جديد).
3. **في سكوت وأي رسالة تانية:** `ctx.relayed.orderId` = طلب السكوت · نتيجة جديدة **`"bot_silent"`** · **ولا إرسال، ولا قراءة للمطعم، ولا لمس للجلسة** (ولا `last_message_at` ولا العدّاد) · سطر `info`: المطعم · الرقم مقنّع · الطلب.

**الاختبارات** (إطار المحرّك والمرسِل الوهمي، والأوقات بـ`UPDATE … = now() - interval` من اتصال التدقيق، زي ح وك وم-أ. صفوف `staff_messages` بتنكتب مباشرة بالاختبار، زي ما الـAPI بيكتبها):

| # | الحالة | المتوقع |
|---|---|---|
| 1 | طلب ماشي + رسالة موظف `pending` من دقيقة، «تمام» | `bot_silent` · ولا رد · `relayed.orderId` = الطلب · `relay_replied_at` ما انلمس |
| 2 | نفسه بـ`sent` | نفس 1 |
| 3 | الرسالة الوحيدة `failed` | سطر م-أ (`relayed`) |
| 4 | الأخيرة `failed`، وقبلها `sent` من 10 دقايق | `bot_silent` (قرار 10) |
| 5 | `silence_until` تبع الأخيرة فات | المسار القائم (سطر م-أ) |
| 6 | «منيو» وقت السكوت | `greeted` والمنيو · `bot_resumed_at` انكتب · رسالة بعدها ← مش ساكت |
| 7 | «المنيو» و«القائمه» | نفس 6 |
| 8 | `bot_resumed_at` بعد الرسالة (الزر) | المسار القائم |
| 9 | رسالة موظف بعد `bot_resumed_at` | `bot_silent` |
| 10 | الطلب صار `completed` بعد الرسالة (صف بالسجل) | سطر م-أ للطلب الخالص |
| 11 | الطلب `completed` قبل الرسالة (شكوى) | `bot_silent` |
| 12 | الطلب `cancelled` بعد الرسالة | المسار القائم |
| 13 | جلسة تصفّح شغّالة + سكوت، «2» | `bot_silent` · السلّة ما تغيّرت · `last_message_at` ما انلمس · العدّاد ما زاد |
| 14 | نفس 13، وبعدها `bot_resumed_at`، و«2» | `browsing` والصنف انضاف (السلّة استنّت) |
| 15 | المطعم مسكّر + سكوت | `bot_silent`، مش نص الإغلاق |
| 16 | الطلبات موقفة + سكوت | `bot_silent`، مش نص الإيقاف |
| 17 | صوتية (`body` NULL) وقت السكوت | `bot_silent` · مربوطة |
| 18 | تفاعل وقت السكوت | `reaction_ignored` · ولا ربط |
| 19 | نفس الرقم ساكت بمطعم تاني | المسار القائم هون |
| 20 | سكوت على طلب A، والزبون عنده طلب أحدث B ماشي | `relayed.orderId` = A |
| 21 | الـwebhook طرف لطرف وقت السكوت | صف `inbound_messages` بـ`order_id` طلب السكوت · ولا صف بـ`outbound_messages` |
| 22 | إشعار حالة وقت السكوت (المُراقِب) | بينبعت زي اليوم |

**ضوابط كسر:**

| الكسر | المفروض يسقط |
|---|---|
| السكوت بعد التوجيه للجلسة الشغّالة | 13 |
| بلا استثناء «منيو» | 6 |
| السكوت بعد بوابة الدوام | 15 |
| الدالة بلا `send_state <> 'failed'` (`CREATE OR REPLACE` مؤقت، زي §2) | 3 و4 |
| شرط الإغلاق بلا مقارنة الوقت (أي إغلاق بينهي السكوت) | 11 |

---

## 6. مج-5 · المحرّك: الطابور

**`src/notify/staff-replies.ts`**، class `StaffReplySender`، على شكل `OrderNotifier`: نفس `start` · `stop` · `tick` · حارس التداخل · `restaurantScope` و`beforeClaim` للاختبارات · `sleep` و`log` محقونين.

**`env.ts` تبع المحرّك:** `STAFF_REPLY_POLL_MS` (الافتراضي `5000`، و`0` بيطفيه، والاختبارات `0`) · `STAFF_REPLY_MAX_WAIT_SECONDS` (الافتراضي `120`) · فحص الإقلاع (قرارات البريف) · `setup-env.ts` · `.env.example`.

**الدورة:**
1. **القائمة:** `app.restaurants_with_pending_staff_messages()` بـ`runUnscoped`.
2. **لكل مطعم، بـ`runInTenant`:**
   - **الانتهاء** (قرار 9): `pending` أقدم من `STAFF_REPLY_MAX_WAIT_SECONDS` من `created_at`، أو `sending` أقدم منها من `claimed_at` ← `failed` · `failure = 'expired'` · `finished_at = now()`. سطر `warn` لكل وحدة.
   - **المرشّحين:** `pending` بترتيب `created_at, id`، لحد `STAFF_REPLY_BATCH_SIZE` (ثابت، 50).
3. **لكل مرشّح بالترتيب، التقاط ذرّي** (معاملة قصيرة بتتقفل قبل الإرسال). انجرّب على Postgres بدور المحرّك:
   ```sql
   UPDATE staff_messages s
      SET send_state = 'sending', claimed_at = now()
     FROM orders o, customers c, restaurants r
    WHERE s.id = $1
      AND s.send_state = 'pending'
      AND s.created_at >= now() - make_interval(secs => $maxWaitSeconds)
      AND o.id = s.order_id AND c.id = o.customer_id AND r.id = s.restaurant_id
   RETURNING s.id, s.order_id, s.body, c.phone_number, r.whatsapp_phone_id;
   ```
   صفر صفوف ← حدا التقطها، تجاوز.
4. **الإرسال** بالمرسِل الخام، **والنص من صف الالتقاط حرفيا:**
   - `whatsapp_phone_id` فاضي ← `failed` · `no_sender_number` · ولا محاولة.
   - نجح ← `sent` · `wa_message_id` · `finished_at`.
   - `WhatsAppSendError` بـ`metaCode = 131047` ← `failed` · `window_closed` · `meta_error_code` · **بلا إعادة.**
   - أي فشل تاني ← إعادة بعد 2 ث و6 ث (`STAFF_REPLY_RETRY_DELAYS_MS`)، وبعدين `failed` · `send_failed` · `meta_error_code` إذا موجود.
   - كل كتابة نهائية بشرط `AND send_state = 'sending'`. صفر صفوف ← سطر `error` (ما لازم يصير).
   - سطر `info` لكل رسالة: المطعم · الرقم مقنّع · الطلب · معرّف الرسالة · النتيجة. **ولا النص.**
5. **`main.ts`:** `MetaWhatsAppSender` بينعمل مرة وحدة، والـsaving wrapper حواليه زي اليوم، والطابور بياخد الخام نفسه. `start` بعد الاستماع، و`stop` قبل المخزن، زي المُراقِب.

**الاختبارات** (`test/staff-replies.test.ts`، على نمط `notifier.test.ts`):

| # | الحالة | المتوقع |
|---|---|---|
| 1 | رسالة `pending` | إرسال واحد: `to` رقم الزبون · `phoneNumberId` رقم المطعم · النص حرفيا · `sent` · `wa_message_id` · `finished_at` |
| 2 | بعد الإرسال | ولا صف بـ`outbound_messages` |
| 3 | دورتين بنفس الوقت (`beforeClaim`) | إرسال واحد |
| 4 | فشل عابر مرتين وبعدين نجاح | 3 محاولات · `sent` |
| 5 | فشل 3 مرات | 3 محاولات بالزبط · `failed` · `send_failed` · `meta_error_code` |
| 6 | ميتا `131047` | محاولة وحدة · `failed` · `window_closed` |
| 7 | مطعم بلا `whatsapp_phone_id` | ولا محاولة · `no_sender_number` |
| 8 | `pending` من 121 ث | ولا إرسال · `expired` |
| 9 | `sending` من 121 ث (العملية ماتت) | `expired` |
| 10 | `pending` من 119 ث | بينبعت |
| 11 | تلات رسائل لنفس الزبون | بنفس ترتيب `created_at` |
| 12 | مطعمين | كل رسالة من رقم مطعمها · ولا رسالة لمطعم تاني |
| 13 | بعد 8، والزبون عنده رسالة `sent` قبلها | `app.bot_silence` بترجع للرسالة اللي قبلها (قرار 10) |
| 14 | `STAFF_REPLY_POLL_MS=0` | ولا مؤقّت |
| 15 | فحص الإقلاع: `STAFF_REPLY_MAX_WAIT_SECONDS=30` مع المهلة الافتراضية | المحرّك بيرفض يقلع |

**ضوابط كسر:**

| الكسر | المفروض يسقط |
|---|---|
| الالتقاط بقراءة وبعدين كتابة (مش `UPDATE … RETURNING`) | 3 (إذا الاختبار ثابت. إذا مش ثابت، اكتب ذلك بالتقرير ووقّف هالضابط بس) |
| إعادة على `131047` | 6 |
| بلا الانتهاء | 8 |
| الإرسال بالـsaving wrapper | 2 |

---

## 7. مج-6 · سكربت التجربة `scripts/demo-staff-message.mjs`

**على نمط `demo-order-status.mjs` بالزبط:** أداة تطوير، **لا تُستعمل مع مطعم حقيقي** · بيرفض بـ`NODE_ENV=production` · بيقرأ `DEMO_STAFF_EMAIL` و`DEMO_STAFF_PASSWORD` وما بيطبعهم ولا بيطبع التذكرة · بيحكي مع الـAPI زي ما الشاشة رح تحكي · مخرجه سطر واحد (`OK …` أو `FAIL <الكود> <السبب>`).

```
node --env-file=.env scripts/demo-staff-message.mjs <رقم الطلب> "<النص>"    # بيبعت، بـclientId جديد
node --env-file=.env scripts/demo-staff-message.mjs <رقم الطلب> --resume    # «رجّع للبوت»
node --env-file=.env scripts/demo-staff-message.mjs <رقم الطلب> --status    # آخر رسالة موظف، والسكوت، ومهلة الرد
```

- **الطلب بالرقم:** بـ`orders` و`returned` تبع `active`، وبعدين أول صفحة من `history` (درس م-أ: سكربت الحالة ما بيلاقي الطلب الخالص).
- **`--status`:** سطر واحد، بلا تواريخ: مثلا `OK 120 sent · silent 58m · window 23h49m`، أو `pending` / `failed expired` · `not silent` · `window closed`. الدقايق محسوبة من أوقات الـAPI مقابل ساعة الجهاز.

---

## 8. مج-7 · الوثائق

- **`CLAUDE.md`:** Layout (المحرّك: `bot-silence.ts` و`notify/staff-replies.ts` · الـAPI: المسارين) · *Known gaps*: بند جديد «الموظف بيكتب للزبون»: قاعدة السكوت بسطرين، والمتغيّرات الأربعة، وشو مش مبني (الشاشة م-د · الصوتيات والصور م-هـ · «وصلت ✓») · Tests، إذا عدّ البوابة تغيّر.
- **`docs/13-dashboard-api-brief.md` §9:** المسارين، و`messages()` و`list()` كما انبنوا (بالقسم).
- **مش ملف البريف:** «كما انبنى» بالتقرير.

---

## 9. التجربة على لاب محمد — بالتقرير، أمر أمر

**بلغة بسيطة. كل أمر بيبلّش بـ`cd ~/sufria &&`، وتحت كل أمر شو المفروض يطلع.** الشاشة لسا ما انبنت: رسالة الموظف رح تبين بمحادثة الطلب زي رد البوت لحد م-د، والكتابة بالسكربت.

1. **الفرع:** `git fetch origin && git switch --detach origin/feat/staff-reply`، وبعده `pnpm --filter @sufria/shared build`.
2. **`pnpm check:budget`** ← نفس أرقام `main`: `/login` 138596 · `/orders` 147988 · `/history` 148138 · `/orders/[id]` 151180 · `/menu` 151676 · `/menu/removed` 149588 · الخطوط 123204. أي فرق ← بالتقرير.
3. 🔴 **نسخة احتياطية** لقاعدة العرض قبل الهجرة: `/root/sufria-backups/sufria-demo-<التاريخ>-before-0018.dump`، صلاحية 600. اكتب الأمر كامل.
4. 🔴 **terminal جديد**، أو تأكد إنه `echo "${MIGRATION_DATABASE_URL##*@}"` بيطلع فاضي. بعدها `pnpm db:migrate` ← 0018 لحالها. **مش `db:reset`.**
5. **أربع نوافذ:**
   - الـAPI، عادي (السكوت 60 دقيقة).
   - المحرّك، بـ`RELAY_OPEN_ORDER_MAX_MINUTES=60 RELAY_CLOSED_ORDER_MINUTES=60 RELAY_REPLY_QUIET_MINUTES=1` قبل الأمر (مش بالـ`.env`).
   - الواجهة (`build` ثم `start`)، عشان محادثة الطلب.
   - النفق، ورابطه بميتا.
6. **السيناريوهات** (`demo-staff-message.mjs` للكتابة، و`demo-order-status.mjs` للحالة):
   - **أ، الموظف بيكتب:** «منيو» ← «1» ← «تم» ← «استلام» ← «أكّد». بالسكربت: «مرحبا، معك المطعم» ← بتوصل على واتساب خلال 5 ث تقريبا · `--status` ← `sent · silent 59m`.
   - **ب، الزبون بيرد:** «تمام» ← **ولا رد من البوت** · باللوحة: الفقاعة والنقرة، و«تمام» بالمحادثة.
   - **ج، الإشعارات بتضل:** اقبل الطلب بسكربت الحالة ← «أكّدنا طلبك رقم …» بتوصل.
   - **د، «منيو» بترجّع البوت:** «منيو» ← المنيو · استنى دقيقة ← «وين طلبي؟» ← سطر الحالة.
   - **هـ، الزر:** بالسكربت رسالة جديدة ← `--resume` ← «مرحبا» ← سطر الحالة.
   - **و، السلّة بتستنى:** «منيو» ← «1» (سلّة شغّالة) · بالسكربت رسالة على طلب أ ← «2» ← ولا رد · `--resume` ← «2» ← الصنف انضاف للسلّة.
   - **ز، إغلاق الطلب بيرجّع البوت:** بالسكربت رسالة ← حرّك الطلب لحد «مكتمل» بسكربت الحالة (`preparing` ← `ready` ← `completed`) ← «شكرا» ← «وصلت رسالتك للمطعم بخصوص طلبك رقم …» · بعدها بالسكربت رسالة على نفس الطلب ← «الأكل كان بارد» ← ولا رد (ساكت من جديد) · باللوحة: الطلب رجع بمجموعة «رسائل جديدة على طلبات منتهية».
   - **ح، صوتية وقت السكوت:** صوتية ← ولا رد · باللوحة «رسالة صوتية — لا تظهر هنا».
   - **ط، الرسالة اللي استنّت كتير ما بتطلع:** Ctrl+C بنافذة المحرّك ← بالسكربت رسالة ← استنى 3 دقايق ← شغّل المحرّك ← **ما بتوصل** · `--status` ← `failed expired`.
   - **ي، الـ60 دقيقة:** طلب جديد لحد «أكّد» ← أعد تشغيل الـAPI بـ`BOT_SILENCE_MINUTES=1` قبل الأمر ← بالسكربت رسالة ← استنى دقيقتين ← «مرحبا» ← سطر الحالة.
   - **ك، الـ24 ساعة:** أعد تشغيل الـAPI بـ`REPLY_WINDOW_MINUTES=1` ← ما تبعت إشي من واتساب لدقيقتين ← بالسكربت رسالة ← `FAIL 409 reply_window_closed`.
7. **الإرجاع:** إلغاء طلبات التجربة اللي لسا مفتوحة بسكربت الحالة · Ctrl+C بالنوافذ · `git switch main`.

---

## 10. التقرير

1. جدول مج-0.
2. الكوميتات (`mc-<رقم>`، بند بكوميت)، **والكاتب بكل واحد** (`git log --format='%h %an %s' origin/main..HEAD`)، وتأكيد إنه ما في سطور الكاتب المشترك: `git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by\|claude-session'` = `0`.
3. الاختبارات قبل وبعد لكل حزمة، والبوابة · `verify` = 0 بـ`.env.test` · `check:budget`.
4. **الاختبارات القائمة اللي تغيّرت:** بالاسم، وشو تغيّر، وليش (المتوقع: فيكسترز الواجهة بس).
5. ضوابط الكسر: المتوقع مقابل اللي صار.
6. قرارات أثناء التنفيذ (ومنها شكل تغيير `WhatsAppSender`).
7. **«كما انبنى»:** الفرق عن البريف، بالقسم. هون بالتقرير، مش بملف البريف.
8. خطوات اللاب (§9).
9. ما لم يُبنَ ولماذا.
10. آخر شي، **حرفيا:** `git status --short && git log --oneline -15`، وآخر 15 سطر من `verify`.

**الفرع:** `feat/staff-reply` · مرفوع · **لا PR ولا دمج.**

---

## 11. خارج هذه المهمة

- **كل الشاشة (م-د):** صندوق الكتابة تحت المحادثة · شكل رسالة الموظف وحالتها · زر «رجّع للبوت» · سطر الـ24 ساعة · اسم الموظف · وقف رنين الطلب المعلّق (`soundFor`) · كل النصوص.
- **عرض الصوتيات والصور الحقيقي (م-هـ)**، بعد م-د وقبل أي مطعم حقيقي.
- **«وصلت ✓ / انقرت»** (أحداث التسليم من ميتا). الرقم بينحفظ هلق بس.
- **ردود جاهزة · الكتابة لزبون بلا طلب · تعديل أصناف الطلب.**
- **إشعار المتصفح · الشاشة الصاحية · تنبيه واتساب لرقم المطعم · «لحظة بلحظة»** (مع الاستضافة أو بعدها).
- **أي تعديل بالمُراقِب أو بقاعدة م-أ أو بمهلة الجلسة.**
