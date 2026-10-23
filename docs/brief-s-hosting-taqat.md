# بريف المهمة س — الاستضافة على طاقات: تطبيق واحد

**Sufria · 23 أكتوبر 2026 · لكلود كود (🔴 جلسة على الكلاود، effort high) · فرع جديد `feat/hosting-taqat` من `origin/main` (`7ed6689` + كوميت البريف)**

**البريف على `main`:** `docs/brief-s-hosting-taqat.md` (`git fetch origin && git show origin/main:docs/brief-s-hosting-taqat.md`). **لا تنسخه للفرع ولا تعدّله.** «كما انبنى» بالتقرير بس (§10).

**النطاق:** كل اللي بيلزم عشان سُفريا تشتغل على استضافة طاقات **كتطبيق واحد** (قرار محمد A، 23 أكتوبر): ملف Nixpacks · مشغّل للبرامج التلاتة · اللوحة والـAPI والـwebhook على نفس الرابط · سكربت تجهيز القاعدة · طريقة الدفع بسكربت إعداد المطعم · الوثائق.
**مش بالنطاق:** النشر نفسه على طاقات (محمد بيعمله من التلفون بعد الدمج) · أي هجرة · أي تغيير بشكل اللوحة.

**نقطة التوقف:** س-0 الفحص · س-1 Nixpacks · س-2 المشغّل · س-3 نفس الرابط · س-4 سكربت التجهيز · س-5 الدفع بسكربت الإعداد · س-6 تجربة كاملة بالحاوية · س-7 Postgres 18 · س-8 الوثائق. كوميت **وpush** بعد كل بند. `verify` الكامل مرة بالآخر. الفرع مرفوع، وبعده تقرير. **بلا PR وبلا دمج.**

**يُقرأ مع (بالقسم، §0ب):** `CLAUDE.md`: Commands (و«On a new machine») · Database names · Rules that do not bend · Tests · شروط الإنجاز. `.env.example` كامل. `scripts/migrate.mjs` · `scripts/psql.mjs` · `apps/dashboard-api/src/setup/setup-restaurant.ts` · `apps/conversation-engine/src/http/server.ts` · `apps/dashboard-web/next.config.ts` · `apps/dashboard-web/shared/api/config.ts`.

> **البريف يقول المطلوب، والريبو يقول الواقع.** عند التعارض: قف واكتب وين اختلف.
>
> **محمد بيراجع بالآخر.** لا تقف إلا عند شرط 🛑. غير هيك: القرار الأبسط الموافق للبريف، وسجّله تحت «قرارات أثناء التنفيذ».

---

## ليش

لاب محمد انكسرت شاشته، وكل سُفريا كانت عليه: القاعدة والمحرّك والـAPI والنفق. **ما في لاب ولا شاشة هلق: محمد بيشتغل من التلفون بس.** فبنشغّل سُفريا على استضافة طاقات المجانية (لبرنامج كود ماب)، وكل الإعداد هناك بيصير من متصفح التلفون: صفحة Environment، وTerminal جوّا الحاوية، والـLogs. **كل خطوة يدوية بعد الدمج لازم تكون أمر واحد قصير بالـTerminal، أو خانة بالـEnvironment.**

## اللي منعرفه عن طاقات (من محمد ومن لقطات، 19 أكتوبر)

- تبويب Hosting على taqat.academy، «زي Railway تقريبا». **Builder: NIXPACKS.** بتاخد الكود من GitHub، وكل push على `main` بينزل لحاله (Deploy key + Webhook).
- رابط `<اسم>.apps.taqat.academy` بـHTTPS تلقائي.
- تبويبات: Environment (مع Import .env) · Database · Logs · Terminal (shell جوّا الحاوية) · Domain.
- **Postgres 18.4، والمستخدم `postgres` مدير كامل** (`rolsuper` و`rolcreaterole` و`rolcreatedb`).
- 🔴 **المنصة بتحقن `DATABASE_URL` على المدير** (نفس الاسم اللي الـAPI بيقراه، ومفروض يكون `sufria_dashboard`). المدير بيتخطّى الـRLS. الحارس الموجود بالـAPI والمحرّك (`rolsuper`/`rolbypassrls` ← ما بيقلعوا) بيمسكها، بس ما منعرف إذا قيمتنا بالـEnvironment بتغلب حقن المنصة. **فما منعتمد على اسم `DATABASE_URL` أبدا** (§س-2).
- محمد بيقول إنها بتدعم Node 26، يعني Nixpacks عندهم جديد (Node 24 انضاف بـNixpacks 1.41، أكتوبر 2025).

**❓ مش معروف، وبيبين بعد النشر بس:** التطبيق بينام لما ما في زيارات؟ · الذاكرة والتخزين؟ · نسخ احتياطية؟ · `PORT` شو قيمته؟ ← التصميم لازم يشتغل بكل الحالات، ويخلّي الجواب يبين بالـLogs (§س-2، سطر الذاكرة).

---

## قرارات محمد — مقفولة

| # | القرار |
|---|---|
| 1 | **تطبيق واحد على طاقات (A)**، والبرامج التلاتة (اللوحة · الـAPI · المحرّك) جوّا نفس الحاوية |
| 2 | **رابط واحد:** اللوحة على `/` · الـAPI على `/api/…` · webhook ميتا على `/webhooks/whatsapp`. اللوحة (Next) بتحوّلهم لجوّا |
| 3 | **Node 24 بس** (`package.json`: `>=24 <25`). ولا 26 |
| 4 | **ولا تغيير بالكود بيبين للموظف أو للزبون** |

### قرارات البريف (من Claude، بتمشي إلا إذا الريبو بيقول غير)

1. **الهجرات يدوي، مش مع كل نشر:** محمد بيشغّل سكربت التجهيز (§س-4) من الـTerminal. ليش: هجرة بتنطبق لحالها مع أي push على `main` بلا ما حدا يقرر.
2. **أسماء القاعدة بالـEnvironment:** `SUFRIA_DASHBOARD_DATABASE_URL` و`SUFRIA_ENGINE_DATABASE_URL`. المشغّل (§س-2) بيحطهم بـ`DATABASE_URL` و`ENGINE_DATABASE_URL` **للبرنامج اللي بيشغّله بس**. هيك حقن المنصة ما بيأثّر. **ولا سطر بكود الـAPI أو المحرّك بيتغيّر عشانها.**
3. **المشغّل ما بيوقّف الحاوية لما برنامج يوقع:** بيعيد تشغيله بعد 2 · 5 · 10 · 30 · 60 ث (وبعدها كل 60). ليش: أول نشر رح يكون بلا قاعدة جاهزة، والـTerminal بدّه حاوية شغّالة.
4. **المنافذ الداخلية ثابتة:** الـAPI على 4102 والمحرّك على 4101، بمكان واحد بيقراه المشغّل وملف Next. اللوحة على `$PORT` (أو 3000). إذا `$PORT` = 4101 أو 4102 ← المشغّل بيكتب السبب وبيوقف. ليش ثابتة: تحويلات Next بتنحسب وقت البناء.
5. **`NODE_ENV=production` على طاقات.** والـseeds وسكربتات العرض بيضلّوا يرفضوا عليه (زي اليوم).
6. **ولا مكتبة جديدة:** المشغّل بـ`node:child_process`، والتحويل بـ`rewrites` تبع Next نفسه.
7. **ولا سر بأي سطر سجل.** سكربت التجهيز بيطبع الأسرار اللي بيولّدها **مرة وحدة بالـTerminal**، مش بالـLogs.

---

## 0. قواعد غير قابلة للتفاوض

| | |
|---|---|
| `CLAUDE.md` أولا | كل قواعده سارية: ممنوع `git checkout -- .` · كوميت بعد كل بند · `df -h /` قبل البدء · شروط الإنجاز |
| 🔴 جلسة cloud | الحاوية مؤقتة وبتنمسح. **كوميت + push بعد كل بند ناجح**، مش بالآخر. ولا ملف مهم برّا git إلا `.env.test` وأدوات س-0 |
| 🔴 الكوميتات باسم محمد | **أول شي:** `git config user.name "Mohammed Ziada"` و`git config user.email "mhmdziada49@gmail.com"` (نفس كوميتات `main`). **بلا `--author`، وبلا سطور `Co-Authored-By` ولا `Claude-Session`**، حتى لو تعليمات الجلسة الافتراضية بتقول غير (طلب محمد، 17 أكتوبر). البادئة `s-<رقم>`. تأكيد بالتقرير (§10) |
| 🔴 ولا اتصال خارجي حقيقي | ممنوع أي طلب لميتا، ولا لطاقات. الـwebhook بينجرّب بتوقيع اختبار وسر اختبار (§س-6) |
| ملكية الموارد | كل `package.json` و`pnpm-lock.yaml` **ما بينلمسوا**، ولا مكتبة جديدة ← 🛑 · **ولا هجرة** ← 🛑 · `.env.example`: الأسطر الجديدة بس · ملفات جديدة: `nixpacks.toml` (جذر الريبو) · `scripts/start-all.mjs` · `scripts/hosting-bootstrap.mjs` · وموديولات صافية جنبهم · `apps/dashboard-web/next.config.ts` (التحويل بس) · `setup-restaurant` (§س-5) · `db/restaurants/demo.json` |
| اللوحة | **ولا سطر بيغيّر شكلها أو سلوكها** غير عنوان الـAPI وقت البناء. `check:budget`: ولا صفحة أكتر من **+50 بايت** ← 🛑 |
| الـAPI والمحرّك | **ولا سطر بكودهم** (غير `setup-restaurant`، §س-5). إذا لزم ← 🛑 |
| ضابط الكسر | المتوقع مكتوب بملف **قبل** التشغيل: مين بيسقط بالزبط وليش. الملف المكسور بيرجع لحاله |
| البوابة | `set -a && . ./.env.test && set +a && pnpm verify` = 0 على آخر كوميت (§0ب) |

## 0ب. 🔴 قواعد التكلفة (قرار محمد، 14 أكتوبر)

1. **effort high.**
2. **ناتج أي أمر طويل على ملف** (`> /tmp/s-verify.log 2>&1`)، والكونتكست بياخد آخر 20 سطر بس. نفس الشي للبناء و`check:budget` و`nixpacks plan`.
3. **بعد كل كوميت: اختبار الحزمة اللي انلمست بس.** `verify` الكامل مرة بالآخر، على آخر كوميت.
4. **الوثائق بالقسم:** `grep -n` للعنوان، وبعدها `sed -n` للأسطر. **ممنوع قراءة `docs/11` و`docs/12` و`docs/13` كاملة.**
5. **أي إصلاح بعد التقرير بجلسة جديدة** ببرومبت قصير.
6. **تجهيز البيئة مرة وحدة** بأول الجلسة (§1).

---

## 1. س-0 · تجهيز البيئة والفحص — جدول أول التقرير، ثم تابع

**البيئة (نفس وصفة بريف ك §1 وم-أ §1، اللي انجرّبت بالكلاود):** الحاوية فيها Node 22، والريبو بدّه **Node 24 وpnpm 9.15.0**. PostgreSQL 16 موجود.

```bash
mkdir -p ~/tools && cd ~/tools && npm init -y >/dev/null && npm i node@24 pnpm@9.15.0
export PATH=~/tools/node_modules/.bin:$PATH && node -v && pnpm -v   # v24.x · 9.15.0
```

**`export PATH` بيرجع مع كل shell جديد.** بعدها: `pnpm install --frozen-lockfile` · نسخة الاختبارات بوصفة `CLAUDE.md` (Commands، «On a new machine»): `pg_createcluster 16 test --port 5434 …` والأدوار التلاتة بكلمات سر عشوائية · `.env.test` بصلاحية 600 (تأكد بـ`git check-ignore`) · `createdb … --icu-locale=ar-JO` · `pnpm db:migrate` · الـseeds الأربعة (**مش `pnpm db:seed`**).

| # | الفحص | 🛑 |
|---|---|---|
| 1 | `df -h /` · `git log --oneline -3 origin/main` (آخره كوميت البريف فوق `7ed6689`) · `verify` على الأساس = 0، بالأرقام. المتوقع: shared 340 · web 260 · المحرّك 400 · الـAPI 431 · `test:db` 7 · البوابة 23 + 4 · التباين 56 | إذا مش 0 |
| 2 | `check:budget` على الأساس = `perf-budget.json` (`/login` 138642 · `/orders` 148304 · `/history` 148455 · `/orders/[id]` 155817 · `/menu` 151767 · `/menu/removed` 149679 · الخطوط 123204). إذا خطوط Google ما بتنزل بالكلاود: طريقة `claude/أدوات-قياس-الحجم-بالكلاود.md` (`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`)، واكتب إنه الخطوط ما انقاست | إذا الـJS مختلف |
| 3 | كيف كل برنامج بيقلع: `apps/*/package.json` (`start`) · `dist/main.js` بعد `pnpm build` · المنافذ من `ENGINE_PORT` و`DASHBOARD_API_PORT` · اللوحة `next start` | — |
| 4 | مين بيقرا `DATABASE_URL` و`ENGINE_DATABASE_URL` و`MIGRATION_DATABASE_URL`: `config/env.ts` بالاتنين · `scripts/psql.mjs` (بيرجع لـ`DATABASE_URL` إذا ما في `MIGRATION_DATABASE_URL`) · `scripts/migrate.mjs` | — |
| 5 | الحارس: `tenant-db.ts` بالمحرّك و`tenant-db.service.ts` بالـAPI بيرفضوا `rolsuper` و`rolbypassrls` | إذا مش موجود |
| 6 | مسارات الـAPI على الجذر (`/auth/…` · `/orders/…` · `/health`)، بلا prefix | — |
| 7 | المحرّك: `WEBHOOK_PATH` = `/webhooks/whatsapp` · `/health` · التوقيع على البايتات الخام (`server.ts`) | — |
| 8 | اللوحة: `API_URL` = `NEXT_PUBLIC_API_URL` أو `http://localhost:3002` (`shared/api/config.ts`)، وبيندمج وقت البناء | — |
| 9 | `scripts/demo-payment.mjs` بيرفض `NODE_ENV=production` (السطر 29)، يعني على طاقات ما في طريقة تحط المطعم تحويل غير §س-5 | — |
| 10 | `setup-restaurant`: الحقول اللي بيقراها من `demo.json`، وكلمة سر الموظف بتنولّد وبتنطبع مرة وحدة | — |
| 11 | `0003_roles_and_rls.sql`: `CREATE ROLE sufria_dashboard LOGIN` بلا كلمة سر (`dev-role-passwords.sql` بيعطيها `devpass` بالتطوير بس) | — |
| 12 | **Nixpacks:** نزّل الـbinary من GitHub releases (`railwayapp/nixpacks`، آخر نسخة)، برّا الريبو. إذا ما نزل: اكتبه، وكمّل بلا `nixpacks plan` | — |

**اكتب النتائج أول التقرير، وتابع بلا انتظار** (إلا عند 🛑).

---

## 2. س-1 · `nixpacks.toml` (جذر الريبو)

**المطلوب، مش الصياغة:** ارجع لوثائق Nixpacks للصياغة الصحيحة (`[phases.setup]` · `[phases.install]` · `[phases.build]` · `[start]` · `[variables]`).

| | |
|---|---|
| Node | **24** (`NIXPACKS_NODE_VERSION=24`). إذا Nixpacks قديم وما بيعرفه: `nixpkgsArchive` لـcommit من nixpkgs فيه `nodejs_24`، واكتب الـSHA ومصدره |
| pnpm | 9.15.0 من `packageManager` (corepack). **ولا نسخة تانية** |
| أدوات إضافية | عميل Postgres (`psql` و`pg_dump`، مثلا `postgresql_18`)، عشان `scripts/psql.mjs` والـTerminal |
| التثبيت | `pnpm install --frozen-lockfile --prod=false`. 🔴 Nixpacks بيحط `NODE_ENV=production`، وpnpm وقتها بيتخطّى devDependencies (فيها `typescript` و`@swc-node/register` اللي سكربت الإعداد بيحتاجه) |
| البناء | `pnpm build` (كل الحزم بترتيبها، واللوحة `next build`)، مع **`SUFRIA_SAME_ORIGIN=1` و`NEXT_PUBLIC_API_URL=/api`** وقت البناء (§س-3) |
| التشغيل | `node scripts/start-all.mjs` |

**الفحص:** `nixpacks plan .` (إذا نزل، س-0 #12): Node 24 · pnpm 9.15.0 · أوامر التثبيت والبناء والتشغيل زي الجدول. **الخطة كاملة بالتقرير.**

**ضابط كسر:** شيل `--prod=false` ← `nixpacks plan` بيطلّع أمر تثبيت بلا devDependencies (أو اكتب ليش ما بيبين).

## 3. س-2 · المشغّل `scripts/start-all.mjs`

**الفكرة:** برنامج واحد بيشغّل التلاتة كبرامج أولاد، وبيراقبهم.

| الولد | الأمر | البيئة اللي بياخدها (فوق بيئة الحاوية) |
|---|---|---|
| `api` | `node apps/dashboard-api/dist/main.js` | `DASHBOARD_API_PORT=4102` · `DATABASE_URL` = `SUFRIA_DASHBOARD_DATABASE_URL` |
| `engine` | `node apps/conversation-engine/dist/main.js` | `ENGINE_PORT=4101` · `ENGINE_DATABASE_URL` = `SUFRIA_ENGINE_DATABASE_URL` |
| `web` | `next start` بمجلد `apps/dashboard-web` | `-p $PORT` (أو 3000) و`-H 0.0.0.0` |

- **`DATABASE_URL` تبع المنصة ما بيوصل لأي ولد:** المشغّل بيشيله من بيئة `api` و`engine` و`web`، وبيحط بداله القيمة اللي فوق (قرار 2). `MIGRATION_DATABASE_URL` كمان ما بيوصل لحدا.
- **قيمة ناقصة** (`SUFRIA_DASHBOARD_DATABASE_URL` أو `SUFRIA_ENGINE_DATABASE_URL`): الولد ما بيقلع، وسطر واضح كل 60 ث: `[start-all] api waiting: SUFRIA_DASHBOARD_DATABASE_URL is not set — run: node scripts/hosting-bootstrap.mjs`. **`web` بيقلع كيف ما كان.**
- **ولد وقع:** بيرجع بعد 2 · 5 · 10 · 30 · 60 ث، وبعدها كل 60 (قرار 3). ولد ضل شغّال 5 دقايق ← العدّاد بيرجع للأول.
- **SIGTERM / SIGINT:** بيبعتها للتلاتة، بيستنى لحد 10 ث، وبعدها بيطلع.
- **السجل:** كل سطر من ولد بيبلّش بـ`[api]` · `[engine]` · `[web]`. سطور المشغّل نفسه `[start-all]`. **ولا قيمة متغيّر بأي سطر** (أسماء بس).
- **سطر الذاكرة كل 10 دقايق:** `[start-all] rss api=… engine=… web=… total=… MB · up=…` (من `ps` أو `/proc`). ليش: بيجاوب على «بينام؟» (فجوات بالسطر) و«قدّيش الذاكرة؟».
- **المنافذ:** قرار 4.

**الاختبارات:** المنطق بموديول صافي جنبه (مثلا `scripts/start-all-lib.mjs`): البيئة لكل ولد (`DATABASE_URL` تبع المنصة ما بيوصل · الاستبدال · الناقص ← انتظار) · جدول الرجوع (2 · 5 · 10 · 30 · 60 · 60، ورجوع للأول بعد 5 دقايق) · `$PORT` = 4101 أو 4102 ← رفض · سطر الذاكرة بلا قيم متغيّرات. **لازم يشتغلوا جوّا `pnpm verify` بلا لمس `package.json`:** مثلا ملف `.test.mts` بـ`apps/dashboard-web/test/hosting/` بيستورد الموديول، أو أي مكان تاني بتلقطه أوامر الاختبار الموجودة. اكتب وين وليش.

**ضوابط كسر:**

| الكسر | المفروض يسقط |
|---|---|
| `DATABASE_URL` تبع المنصة بيوصل للـapi | اختبار البيئة |
| الرجوع ما بيرجع للأول بعد 5 دقايق | اختبار الجدول |

## 4. س-3 · نفس الرابط (`next.config.ts`)

- **بس لما `SUFRIA_SAME_ORIGIN=1` وقت البناء** (بالتطوير على اللاب ولا إشي بيتغيّر):
  - `/api/:path*` ← `http://127.0.0.1:4102/:path*`
  - `/webhooks/whatsapp` ← `http://127.0.0.1:4101/webhooks/whatsapp` (GET وPOST)
- `NEXT_PUBLIC_API_URL=/api` وقت البناء ← `http.ts` بيعمل `/api/orders/…` نسبي. تأكد إنه `url()` بـ`http.ts` بيشتغل مع عنوان نسبي (بلا `new URL` بيحتاج أصل).
- **🔴 التوقيع:** ميتا بتوقّع البايتات الخام، والمحرّك بيفحصها قبل `JSON.parse`. التحويل لازم يوصّل الجسم زي ما هو، بايت ببايت. **بيتحقق بـ§س-6، مش بالقراءة.**
- **الـCORS:** مع نفس الرابط ما في طلب cross-origin. `DASHBOARD_WEB_ORIGIN` بيضل زي ما هو (رابط طاقات بالـEnvironment).

**ضابط كسر:** التحويل بيمرّ بلا `SUFRIA_SAME_ORIGIN` ← بيسقط اختبار «التطوير ما تغيّر» (اختبار بيقرأ الإعداد بالحالتين).

## 5. س-4 · `scripts/hosting-bootstrap.mjs`

**الفكرة:** أمر واحد بالـTerminal بيجهّز القاعدة، وبيعطي محمد القيم اللي بيحطها بالـEnvironment. **بينعاد بأمان:** تاني مرة ما بيخرّب إشي.

**اتصال المدير:** `MIGRATION_DATABASE_URL` إذا موجود، وإلا `DATABASE_URL` تبع المنصة. **لازم يكون `rolsuper`** (عند طاقات هو، و`pg_authid` بدّه superuser)، وإلا بيوقف بسطر واضح. اسم القاعدة بيتبدّل بـ`sufria`.

**بالترتيب:**
1. **القاعدة `sufria`:** إذا مش موجودة ← `CREATE DATABASE sufria TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ar-JO' LOCALE 'C.UTF-8'` (نفس `CLAUDE.md`). إذا ICU مش متاح ← `C.UTF-8` لحاله، وسطر تحذير.
2. **الهجرات:** نفس `migrate.mjs` (استورد منطقه، ولا تنسخه)، على `sufria`. كل ملف انطبق بيطلع اسمه.
3. **كلمات سر الأدوار:** **أول مرة بس** (أو مع `--reset-passwords`): كلمتين عشوائيتين (`crypto.randomBytes`، 24 بايت base64url)، و`ALTER ROLE sufria_dashboard PASSWORD …` و`sufria_engine`. «أول مرة» = الدور بلا كلمة سر (`pg_authid.rolpassword IS NULL`). الأدوار بتنعمل بـ0003 (`CREATE ROLE … LOGIN`)، فالخطوة بعد الهجرات.
4. **`JWT_SECRET`:** أول مرة بس، 48 بايت base64. (السكربت ما بيعرف إذا محمد حطه، فبيطبعه بس لما بيولّد كلمات السر.)
5. **الشبكة:** طلب HEAD (مهلة 5 ث) لـ`https://graph.facebook.com` و`https://lookaside.fbsbx.com` ← ✓ أو ✗ لكل واحد. ✗ ← سطر: المحرّك ما رح يقدر يبعت أو ينزّل وسائط.
6. **الخلاصة**، بالترتيب:

```
✓ database sufria ready (icu ar-JO)
✓ migrations: 21 applied, 0 new
✓ network: graph.facebook.com ✓ · lookaside.fbsbx.com ✓

Put these in Environment — shown this once:
SUFRIA_DASHBOARD_DATABASE_URL=postgres://sufria_dashboard:…@<host>:<port>/sufria
SUFRIA_ENGINE_DATABASE_URL=postgres://sufria_engine:…@<host>:<port>/sufria
JWT_SECRET=…
```

- تاني مرة: نفس الأسطر الأولى، وبدل القيم: `passwords unchanged (use --reset-passwords to make new ones)`.
- 🔴 **ولا كلمة سر المدير ولا أي قيمة من البيئة بتنطبع.** الأسرار المولّدة **على stdout بس** (الـTerminal)، ولا مرة على stderr أو بملف.

**الاختبارات** (على `.env.test`، قاعدة تانية مثلا `sufria_bootstrap_test`، وبتنمسح بعدها): أول تشغيل ← القاعدة والهجرات وكلمات السر بتنطبع · تاني تشغيل ← ولا كلمة سر · `--reset-passwords` ← جديدة · الدورين بيقدروا يتصلوا بالقيم المطبوعة · **الحارس:** الـAPI بالقيمة المطبوعة بيقلع، وبـاتصال المدير بيرفض · اتصال مش مدير ← وقفة بسطر. الشبكة بـfake (ولا طلب حقيقي بالاختبار).
**المكان:** زي §س-2 (جوّا `verify` بلا `package.json`)، أو `tests/db/` إذا في أمر بيلقطه. اكتب وين.

**ضوابط كسر:**

| الكسر | المفروض يسقط |
|---|---|
| كلمات السر بتتغيّر كل تشغيل | اختبار التشغيل التاني |
| كلمة سر المدير بالمخرج | اختبار «ولا سر غير المولّد» |

## 6. س-5 · طريقة الدفع بسكربت إعداد المطعم

- `setup-restaurant` بيقبل بملف المطعم `paymentMethod` (`"cash"` · `"transfer"`) و`transferDetails`، **بنفس قواعد إعدادات الـAPI** (`UpdateRestaurantSettingsRequest`: التنظيف والحدود، و`transfer` بدّه تفاصيل). بلاهم ← كاش زي اليوم.
- `db/restaurants/demo.json`: `"paymentMethod": "transfer"` و`"transferDetails": "جوال باي 059XXXXXXX (عرض تجريبي)"` (حرفيا، نص موجود: نقطة ٢٠ أكتوبر §6.1).
- `--check` بيبيّن طريقة الدفع وطول التفاصيل، **مش التفاصيل.**

**الاختبارات:** تحويل بتفاصيل ← المطعم تحويل · تحويل بلا تفاصيل ← رفض · بلا الحقلين ← كاش · `demo.json` بيمرق `--check`.

**ضابط كسر:** السكربت بيتجاهل `paymentMethod` ← بيسقط اختبار التحويل.

## 7. س-6 · تجربة كاملة بالحاوية (زي طاقات بالزبط، غير الشبكة)

1. `SUFRIA_SAME_ORIGIN=1 NEXT_PUBLIC_API_URL=/api pnpm build`.
2. **cluster تاني مؤقت على منفذ تاني** (مثلا 5440)، فاضي وبلا أدوار، عشان السكربت يعمل `sufria` والأدوار من الصفر زي طاقات · `hosting-bootstrap.mjs` و**`DATABASE_URL` = مدير الـcluster** (زي حقن المنصة)، بلا `MIGRATION_DATABASE_URL`.
3. `NODE_ENV=production PORT=3000` + القيم المطبوعة + `WHATSAPP_*` اختبار (سر وتوكن وهميين) ← `node scripts/start-all.mjs` بالخلفية، والسجل على ملف.
4. **الفحوص، كل واحد بنتيجته بالتقرير:**
   - `curl -s localhost:3000/api/health` ← صحة الـAPI.
   - `setup-restaurant.ts db/restaurants/demo.json` (بأمر `CLAUDE.md`) ← المطعم تحويل · بعدها `POST /api/auth/login` بالإيميل والكلمة المطبوعة ← 200 وتوكن.
   - `GET /api/orders?tab=active` بالتوكن و`x-restaurant-id` ← 200.
   - `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<الاختباري>&hub.challenge=12345` ← `12345`.
   - **`POST /webhooks/whatsapp`** بجسم رسالة نصية بشكل ميتا («مرحبا» من رقم اختبار لرقم المطعم)، موقّع بـ`X-Hub-Signature-256` بالسر الاختباري ← 200، **والرسالة بـ`inbound_messages`**. نفس الجسم بتوقيع غلط ← رفض. **ونفس الجسم بفراغ زيادة بعد التوقيع ← رفض** (يعني التوقيع على البايتات فعلا).
   - **الحارس:** وقّف، وشغّل بـ`SUFRIA_DASHBOARD_DATABASE_URL` = المدير ← `[api]` بيرفض يقلع، والمشغّل بيعيد بالجدول، و`web` شغّال.
   - **ناقص:** بلا `SUFRIA_ENGINE_DATABASE_URL` ← سطر الانتظار كل 60 ث، والباقي شغّال.
   - **SIGTERM** ← التلاتة بيطلعوا خلال 10 ث.
   - سطر الذاكرة (مع `START_ALL_MEMORY_EVERY_MS` قصير للتجربة إذا بدك، **بس الافتراضي 10 دقايق**) ← الأرقام بالتقرير.
   - `grep` على ملف السجل لكل سر مولّد وكل قيمة `WHATSAPP_*` ← **0 نتائج.**
5. المحرّك بيحاول يرد على ميتا ← بيفشل (ولا شبكة لميتا بالكلاود، أو توكن وهمي). **عادي. ولا طلب حقيقي لميتا بالنجاح** (§0).

## 8. س-7 · Postgres 18

- جرّب تنصّب Postgres 18 (`apt.postgresql.org`). إذا نزل: cluster على منفذ تاني · الهجرات 0001–0021 · `test:db` · `test:security`، بنسخة `.env` مؤقتة. **النتيجة بالتقرير.**
- **فشل بسبب 18** ← 🛑، واكتب الخطأ والملف.
- **ما نزل:** اكتبه. أول تشغيل لسكربت التجهيز على طاقات بيصير هو التجربة (قاعدة فاضية، بيانات عرض بس).

## 9. س-8 · الوثائق

- **`CLAUDE.md`:** قسم جديد *Hosting (Taqat)*: التطبيق الواحد والمنافذ · الأسماء `SUFRIA_*` وليش مش `DATABASE_URL` · `hosting-bootstrap.mjs` وإمتى بينشغّل (أول مرة، وبعد كل دمج فيه هجرة) · المشغّل وسطر الذاكرة · قائمة الـEnvironment كاملة (الإجباري والاختياري والافتراضي). *Known gaps:* ولا نسخ احتياطية على طاقات لهلق · النوم والذاكرة مش معروفين · الهجرات يدوي.
- **`.env.example`:** `SUFRIA_DASHBOARD_DATABASE_URL` · `SUFRIA_ENGINE_DATABASE_URL` · `SUFRIA_SAME_ORIGIN`، بتعليق سطر وحد لكل واحد.
- **مش ملف البريف:** «كما انبنى» بالتقرير.

---

## 10. التقرير

1. جدول س-0، ومعه خطة `nixpacks plan` كاملة.
2. الكوميتات (`s-<رقم>`، بند بكوميت)، **والكاتب بكل واحد** (`git log --format='%h %an <%ae> %s' origin/main..HEAD`)، وتأكيد: `git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by\|claude-session'` = `0`.
3. الاختبارات قبل وبعد لكل حزمة · `verify` = 0 · `check:budget` (الأساس والآخر).
4. الاختبارات القائمة اللي تغيّرت: بالاسم، وشو، وليش.
5. ضوابط الكسر: المتوقع مقابل اللي صار.
6. **§س-6 فحص فحص بنتيجته** · سطر الذاكرة · **مخرج `hosting-bootstrap.mjs` أول مرة وتاني مرة** (الأسرار مستبدلة بـ`…`).
7. Postgres 18 (§س-7).
8. **🔴 قائمة الـEnvironment لطاقات:** كل متغيّر، إجباري ولا اختياري، ومن وين قيمته (ميتا · مخرج السكربت · ثابت · افتراضي). **بلا قيم سرية.** محمد بيعبّيها من التلفون، فخليها قصيرة.
9. قرارات أثناء التنفيذ.
10. **«كما انبنى»:** الفرق عن البريف، بالقسم.
11. ما لم يُبنَ وما انتحقق منه (النوم، الذاكرة الحقيقية، Nixpacks تبع طاقات نفسه، شبكة طاقات).
12. آخر شي، **حرفيا:** `git status --short && git log --oneline -12`، وآخر 15 سطر من `verify`.

**خطوات طاقات: لا تكتبها.** محمد بياخدها من المراجعة.

**الفرع:** `feat/hosting-taqat` · مرفوع · **لا PR ولا دمج.**

---

## 11. خارج هذه المهمة

- **النشر نفسه** · إعداد ميتا (الـwebhook والتوكن) · مسح تطبيق التجربة القديم عند طاقات.
- **نسخ احتياطية** · دومين خاص · Oracle · تقسيم التطبيقات (B).
- **الجلسة بكوكي httpOnly** (صارت ممكنة مع نفس الرابط، بس بريف لحاله).
- **أي هجرة، وأي تغيير بشكل اللوحة.**
- **بريف م-هـ-ب** (جاهز، وبينشغّل بعد الاستضافة).
