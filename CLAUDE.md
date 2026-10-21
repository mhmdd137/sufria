# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Sufria — a WhatsApp-first direct-ordering platform for restaurants. WhatsApp is the
first channel, not the product.
- Working folder: `sufria`
- Repository: `mozz-labs/sufria` (`git@github.com:mozz-labs/sufria.git`)
- Human-facing docs (`docs/*`) are in Arabic. Code, comments, commit messages, and
  CI step names are English. `CLAUDE.md` is bilingual by design: repo facts in
  English, working agreements in Arabic.

## Layout

pnpm workspace monorepo (`apps/*`, `packages/*`). Node `>=24 <25`, pnpm `9.15.0`
(pinned via `packageManager` — never pass a pnpm version in CI, it kills the run
with `ERR_PNPM_BAD_PM_VERSION`).

| Path | Package | What it is |
|---|---|---|
| `packages/shared` | `@sufria/shared` | Drizzle schema mirror + domain logic shared by every app |
| `apps/dashboard-api` | `@sufria/dashboard-api` | NestJS REST API for the restaurant dashboard: orders and their status (with their unread customer messages and `returned`, and `POST /orders/:id/messages/seen` — brief م-ب, `docs/13` §9.1 and §9.11), a staff member's message to the order's customer — `POST /orders/:id/messages` (a `pending` row, nothing sent), `POST /orders/:id/resume-bot`, the staff messages in the conversation with `botSilence` and `replyOpenUntil`, and `staffMessagedAt` on every list item (brief م-ج, `docs/brief-mc-staff-reply-backend.md`, `docs/13` §9.9 and §9.12), restaurant settings (task D); the menu — `GET`/`POST /menu-items`, `PATCH /menu-items/:id` (name, price, availability, archive and bring back), `POST /menu-items/enable-all`, `GET /menu-categories` — and `PATCH /restaurant/orders-pause`, all under the 4096 guard where they can lengthen the menu (brief ي-أ, `docs/brief-ja-menu-backend.md`). Each order line carries its `note` in `GET /orders` and `GET /orders/:id` (brief ن). The transfer payment and a customer's media (brief م-هـ-أ, `docs/brief-mha-media-transfer-backend.md` on `main`): a transfer order accepted and completed like cash, `paymentMethod`/`transferDetails` in the settings, `paymentMethod`/`paymentStatus` on every list item, `media` and `caption` in the conversation, and `GET /orders/:id/media/:mediaId` (`docs/13` §9.13). Contracts as built: `docs/13-dashboard-api-brief.md` §9 (§9.10 for ي-أ) |
| `apps/conversation-engine` | `@sufria/conversation-engine` | WhatsApp webhooks, business-hours gate, session, browsing cart, pickup-or-delivery, address, and order creation (task C); the customer-notification poller (task F, `src/notify/`); the 60-minute session timeout (task H, `docs/17-session-timeout-brief.md`); orders paused and the empty menu (brief ي-أ §4, `src/conversation/orders-paused.ts`); «آخر طلب لك» in a returning customer's first message, and «نفسه» (FR-08, brief ك, `docs/brief-ka-reorder.md`, `src/conversation/reorder.ts`); a customer's message after an order reaches the restaurant — the relay line instead of the menu, the message linked to the order, a reaction stored and nothing else (brief م-أ, `docs/brief-ma-customer-messages.md`, `src/conversation/customer-relay.ts`); the bot keeping quiet for a customer staff are talking to (`src/conversation/bot-silence.ts`), and the queue that sends staff messages (`src/notify/staff-replies.ts`) — brief م-ج; a customer's note for an item — after its number, or in a message of its own — from the cart to `order_items.notes` (brief ن, `docs/brief-n-item-notes.md` on `main`); the restaurant's payment method — ن1 in the summary, `transfer`/`pending_transfer` at «أكّد» — and the notifier's message by payment and the accepted message once (`orderNoticeAr`, `accepted_notice_at`), a customer's media — a `pending` `inbound_media` row by the webhook, the queue that downloads it from Meta (`src/notify/media-fetcher.ts`, `src/whatsapp/media-downloader.ts`) — brief م-هـ-أ |
| `apps/dashboard-web` | `@sufria/dashboard-web` | Next.js staff UI: login, the orders screen (task G, `docs/16-orders-screen-brief.md`), an order's details with its conversation (task I, `docs/brief-i-order-details.md`), and the menu screen with the orders pause — `/menu`, `/menu/removed`, the pause strip on every page (brief ي-ب, `docs/brief-jb-menu-screen.md`); a customer's messages (brief م-ب, `docs/brief-mb-customer-messages-screen.md`) — the latest unread one on its card with the count, closed orders a message brought back in a group of their own above «الطلبات», every kind of message in the conversation (read every 5 s, marked read on the server), and the alert sound: O2 for a pending order (each minute, up to 3 h), M1 for a message, the header's «اكتم الصوت» and two strips (`shared/sound/`); a staff member writing to the order's customer (brief م-د, `docs/brief-md-staff-reply-screen.md`) — the field under the conversation, the staff bubble in its three states, the silence line and «شغّل الرد الآلي», the closed line after 24 hours, and a pending order's ring stopped by a staff message; after the laptop trial (brief م-د-9, `docs/brief-md9-after-trial.md`) the read every second after a send, the step's bar on the real keyboard, and the conversation before the order folded. An item's note: a line of its own under the card's grey line, and under its line on the details page (brief ن §8). Feature-based: `app/` (routes) · `features/<x>/` · `shared/` — see *Dashboard structure*. Talks to `dashboard-api` at `NEXT_PUBLIC_API_URL` |
| `db/migrations` | — | Raw SQL. The single source of truth for the schema |
| `db/seed` | — | Dev-only fixtures |
| `tests/security` | — | Chain-isolation gate (mandatory) |
| `tests/db` | — | Critical-primitive checks + schema-drift detection |

All packages are `private` and unpublished; workspace deps use `workspace:*`.
Cross-package imports go through the package name (`@sufria/shared`), not relative
paths — except `tests/`, which imports `packages/shared/src/*` directly.

## Commands

```bash
pnpm db:up            # start PostgreSQL (Docker) and wait for it
pnpm db:migrate       # apply the files not applied yet — safe on an existing database
pnpm db:seed          # load dev fixtures
# 🔴 Never `pnpm db:reset` on the demo restaurant's database: it wipes it, data and all.
# After ANY database rebuild, recreate the demo restaurant (brief E) — prints its staff password once:
node --env-file-if-exists=.env --import @swc-node/register/esm-register apps/dashboard-api/src/scripts/setup-restaurant.ts db/restaurants/demo.json
pnpm dev              # run all services in parallel
pnpm test:security    # chain-isolation gate — 23 assertions + 4 negative controls
pnpm test:db          # critical primitives + schema drift + the migration tool
pnpm check:rtl        # dashboard-web: logical properties only, no reversing (in verify and CI)
pnpm check:budget     # dashboard-web: JS + fonts before first paint, per page, vs perf-budget.json
                      # (builds first — stop `next dev`; NOT in verify; end of every brief, before every merge)
pnpm verify           # format:check + lint + typecheck + test — run before any push
pnpm --filter @sufria/dashboard-web dev    # single package
# Dev only, never a real restaurant: change an order's status through the API,
# as the dashboard button will (brief F §5). Needs DEMO_STAFF_EMAIL/PASSWORD in .env:
node --env-file=.env scripts/demo-order-status.mjs 101 accepted
# Dev only, the same way: the menu as the menu screen will drive it (brief ي-أ §6).
# <n> is the place in `list` (in `archived` for restore), not the customer's number:
node --env-file=.env scripts/demo-menu.mjs list          # also: archived
node --env-file=.env scripts/demo-menu.mjs pause         # also: resume
node --env-file=.env scripts/demo-menu.mjs price 1 ٣٫٧٥  # also: on <n> · off <n> · archive <n> · restore <n>
# Dev only, the same way: staff write to an order's customer, as the message box
# does (brief م-ج §7). <n> is the order's number:
node --env-file=.env scripts/demo-staff-message.mjs 101 "مرحبا، معك المطعم"
node --env-file=.env scripts/demo-staff-message.mjs 101 --status   # also: --resume
# Dev only, the same way: the restaurant's payment method (brief م-هـ-أ §10) —
# prints the details' length, never the details; and an order's media (no caption):
node --env-file=.env scripts/demo-payment.mjs show   # also: cash · transfer "<details>"
node --env-file=.env scripts/demo-media.mjs 101      # --save: the stored files to <tmp>/sufria-media-101/
```

`pnpm verify` needs a live database: `test:security` and `test:db` connect using
`DATABASE_URL` / `MIGRATION_DATABASE_URL`, and the Jest suites `ENGINE_DATABASE_URL`
too.

🔴 **On the laptop, the tests always run with `.env.test` — never without it**
(Mohammed, 5 October 2026). `.env` points at the demo restaurant's real
database; a test run without `.env.test` writes into it, and the security gate's
negative controls flip `sufria_dashboard` to SUPERUSER and back on whatever
instance they reach.

The tests run on **a Postgres instance of their own**: `test`, on port **5434**
(`pg_createcluster 16 test --port 5434`), next to `main` on 5432 that holds the
demo. Its own roles — `postgres`, `sufria_dashboard`, `sufria_engine` — with
their own passwords, and one database, `sufria_test`. Roles belong to an
instance, so nothing a test does to a role reaches the demo's. `.env.test`
(`/root/sufria/.env.test`, mode 600, gitignored by `.env.*`; a worktree links
to it, as to `.env`) holds the three URLs. Exported, they win over `.env`
everywhere: Node's `--env-file` and both Jest `setup-env.ts` files keep a
variable that is already set. Every test command, then:

```bash
set -a && . ./.env.test && set +a && pnpm verify
```

`postgresql.service` starts both instances at boot, and so does
`sudo service postgresql start` (the instance is `auto` in
`/etc/postgresql/16/test/start.conf`). One stopped by hand while the service
is up: `sudo service postgresql@16-test start`.

On a new machine, once (as root; `<p0> <p1> <p2>` = three new passwords, e.g.
`openssl rand -hex 24`, written into `.env.test` as
`postgres://<role>:<p>@localhost:5434/sufria_test`):

```bash
pg_createcluster 16 test --port 5434 --encoding UTF8 --locale C.UTF-8 --start
sudo -u postgres psql -p 5434 -c "ALTER ROLE postgres PASSWORD '<p0>'" -c "CREATE ROLE sufria_dashboard LOGIN PASSWORD '<p1>'" -c "CREATE ROLE sufria_engine LOGIN PASSWORD '<p2>'"
set -a && . ./.env.test && set +a && createdb --maintenance-db="${MIGRATION_DATABASE_URL%/sufria_test}/postgres" -T template0 -E UTF8 --locale-provider=icu --icu-locale=ar-JO --locale=C.UTF-8 sufria_test
set -a && . ./.env.test && set +a && pnpm db:migrate
set -a && . ./.env.test && set +a && for f in chain-isolation-fixture dev-staff-passwords dev-contact-phone dev-delivery; do psql "$MIGRATION_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f db/seed/$f.sql; done
```

The roles are created by hand, with 0003's attributes (`LOGIN` alone), so they
carry passwords of their own; 0003's `CREATE ROLE … IF NOT EXISTS` then finds
them. Not `pnpm db:seed`: it starts with `dev-role-passwords.sql`, which would
set them to the shared dev passwords. CI is unaffected: one fresh database, no
`.env` at all.

## Database names

| Thing | Name |
|---|---|
| Database | `sufria` |
| Application roles | `sufria_dashboard`, `sufria_engine` — neither is superuser or BYPASSRLS |
| Migration role | `postgres` (owns the tables; the app never connects as it) |
| Migration ledger | `migrations.applied` (`name`, `applied_at`, `baselined`) — its own schema, out of `public`; no grant to the app roles |
| Test instance (local) | Postgres `16/test` on port 5434, its own roles and passwords; database `sufria_test`; URLs in `.env.test` (see *Commands*) |
| Docker container / volume | `sufria-postgres` / `sufria-pgdata` |

**`pnpm db:migrate` is safe on an existing database** (since brief I, 5 October
2026). `scripts/migrate.mjs` records every file it applies in
`migrations.applied`, **in the same transaction as the file** — each file's own
`BEGIN; … COMMIT;` (its first and last statements, refused otherwise) is
replaced by the runner's — so a file and its row commit together or not at
all, and a second run applies nothing. A database built before the ledger
(the demo restaurant's) is recorded up to `0012` as `baselined` — only once it
proves `0012` is there (`app.restaurants_with_unnotified_orders()`, SECURITY
DEFINER); a database that cannot prove it stops before any file, with nothing
changed. A session advisory lock keeps two runs apart. `tests/db/migrate.test.mjs`
(in `test:db`) holds all of it on databases of its own, created and dropped
per test — breaking the "applied?" check drops the second-run test.

**0020 and 0021 are two files on purpose** (brief م-هـ-أ): Postgres refuses
a new enum value inside the transaction that added it ("unsafe use of new
value"), and the runner applies each file in one. 0020 adds `transfer` and
`pending_transfer`, nothing else; 0021 uses them — the restaurant's
`payment_method`/`transfer_details`, the orders' payment CHECKs
(`orders_collected_is_cash` gave way to `orders_collected_is_cash_or_transfer`),
`orders.accepted_notice_at` (backfilled for orders past `accepted`), and
`inbound_media` (a customer's image, voice note or PDF, the bytes in
`content`, 5 MiB at most; RLS; the engine writes, `sufria_dashboard` reads
alone) with `app.restaurants_with_pending_media()` — **Bypass #6**, 0018's
shape (`SETOF uuid`, `sufria_engine` alone, gate A20–A23).

🔴 **`pnpm db:reset` stays forbidden on the demo restaurant's database** — it
wipes it. A new migration reaches that database through `pnpm db:migrate` alone,
after a `pg_dump` to a file outside the repo (it holds customers' phones).

## Rules that do not bend

1. **Do not upgrade past TypeScript `~5.9.3`.** TS 7 has no programmatic compiler
   API and breaks `nest build` and type-aware ESLint. See `docs/ADR-003`.
2. **The security gate is green or nothing merges.** A red `pnpm test:security`
   means one restaurant can read another's data. Blueprint §5.5.
3. **Migrations are append-only.** Once a migration has run on someone's machine,
   add `000N_...` instead of editing it.
4. **SQL is the source, TypeScript is the mirror.** `packages/shared/src/schema.ts`
   is maintained by hand. Never run `drizzle-kit generate` — it silently drops every
   RLS policy, CHECK constraint, and partial index. `pnpm test:db` catches drift.
   `test:db` compares table and column *names* only — RLS policies, CHECK
   constraints, indexes, types and defaults are not checked. Review those by hand.
5. **`DATABASE_URL` must be `sufria_dashboard` (or `sufria_engine`), never
   `postgres`.** A superuser bypasses RLS with no error at all, so isolation checks
   pass without checking anything. `TenantDbService` refuses to start if it detects
   a superuser or BYPASSRLS role.
6. **`.env` never reaches git.** If it does, rotate every key — deleting the file
   does not remove it from history.

## Tests

All four packages run real suites — Jest for the backend apps, `node --test` for
`shared` and `dashboard-web`. The web tests guard the *decision*, not the code:
they fail if a status label is written inline, if a local status map or
`OrderStatus` type reappears, or if `preparing`/`completed` gain a customer
message. Since task G they also fail on **any** Arabic letter in the code of
`app/`, `features/` or `shared/` (every visible text comes from
`DASHBOARD_UI_AR` in `packages/shared/src/dashboard-ui.ts`, or from the menu
screen's own `DASHBOARD_MENU_UI_AR` in `dashboard-menu-ui.ts` — brief ي-ب-9
§3: what only `/menu` and `/menu/removed` show stays off the other pages),
and on a local
copy of an API contract type; since task I, on an import that breaks the
structure (`test/boundaries.test.mts`). The screens' decisions — the card's
text, the pulse, what the next-step button sends and what a 409 leads to, the
details page's view, the cancel's body, `?next=`, the menu row's buttons, what
«حفظ» sends and when «لم يُحفظ» shows — live in `features/orders/lib/`
(`board.ts`, `details.ts`), `features/menu/lib/menu.ts` and
`features/auth/lib/`, as plain TypeScript, because `node --test` cannot import
JSX: components only render what they return. A button's working look is on
`[aria-busy="true"]`, never `:disabled` (brief ي-ب §2, Mohammed, 8 October):
a button disabled for another reason does not look busy —
`test/orders/next-step.test.mts` holds it for every module. The card's "the button does not open the order" is
held by reading the card's TSX and CSS (`test/orders/card.test.mts`): the
press itself needs a browser.

| Package | `test` script | Real? |
|---|---|---|
| `@sufria/dashboard-api` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/conversation-engine` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/shared` | `tsc -b && node --test "test/**/*.test.mts"` | yes |
| `@sufria/dashboard-web` | `tsc -b ../../packages/shared && node --test "test/**/*.test.mts"` | yes |

`shared` holds the pure half — the command matchers, the item parser, the cart
and order texts — so the parsing decisions are tested without a database, and
the engine suites are free to test only what needs one.

`conversation-engine/test/saving-sender.test.ts` covers the saving wrapper
(brief I, I-4): a send that went out leaves one row, a failed send or a text
over the limit none, a failed save neither throws nor logs the number, the row
is its restaurant's alone, the notifier names its order — and a reply sent
inside the inbound transaction arrives and is kept without hanging, while a
save blocked by a row lock gives up at 2 s. Breaks, each dropping only its
tests: saving before the send · letting a failed save throw · removing the 2 s
timeouts (the held-row test then takes 10 s, the pool's own timeout).
`dashboard-api/test/order-messages.test.ts` builds one customer's two orders
minute by minute (a «جاهز» of 101 sent mid-conversation for 102, an image that
anchors a reply, a message 25 h old, one after the last order, another customer,
the same digits at another restaurant). Breaks: ignoring `order_id` drops the
«جاهز» test; dropping the customer condition drops "another customer"; reading
`restaurant_id` from the raw header instead of the guard drops **nothing** —
on this route the guard verified that very header (no `restaurantId` param),
so the protection is the guard, held by `tenant-context.test.ts`.

**Jest, not Vitest, and never `tsx` — see `docs/ADR-004`.** Anything that boots
Nest DI must be compiled by a toolchain that emits `design:paramtypes`. esbuild
(so: `tsx`, and Vitest's default transform) drops it, and constructor injection
then resolves to `undefined` at runtime while `typecheck` and `lint` stay green.
ts-jest compiles with `tsc` itself, so the metadata survives.
`apps/dashboard-api/tsconfig.spec.json` restates `experimentalDecorators` and
`emitDecoratorMetadata` explicitly rather than inheriting them, and one test
asserts that injection actually resolved.

Both Jest suites need a live, seeded database (`pnpm db:migrate && pnpm db:seed`) —
they drive real HTTP requests through the real code and read the tenant context
back out of Postgres. Both run `--runInBand` with `PG_POOL_MAX=1` so the
connection-leak assertion is deterministic. Fixture ids come from
`db/seed/chain-isolation-fixture.sql`.

`dashboard-api/test/tenant-context.test.ts` covers the half `tests/security/`
cannot: that the **application** sets `app.current_restaurant_id`, per request,
only after `RestaurantContextGuard` verified membership, and never leaves it on
the pooled connection. The SQL gate sets that context by hand, so all twelve of
its assertions would still pass with the guard deleted.

`conversation-engine/test/conversation-session.test.ts` covers the reply half:
the business-hours gate, opening exactly one session, and the first outbound
message. It never calls Graph API — `WhatsAppSender` has a recording
implementation next to the real one, and both run the same length check, so a
test that passes against the fake means something about the real one. The clock
is injected, so "closes at 2:00 am" is written as a fixed fact instead of
something that depends on when the suite runs.

Two of its tests exist because deliberately breaking the code dropped too few:
breaking the active-session state filter dropped *zero* tests, so nothing
asserted that a customer who has ordered can start a new conversation. The
conflict-branch test is ordered rather than raced — it holds the winner's
transaction open — because a `Promise.all` race passes or fails depending on
machine load, which it did.

`conversation-engine/test/order.test.ts` guards the two decisions in task C that
no reading of the code would catch. **Post-COMMIT send:** the guard is a test
that forces the failure *at COMMIT* (a deferred constraint trigger), because a
failure forced earlier — the `order_status_history` trigger — fires before the
send is ever reached, so moving the send back inside the transaction drops
nothing. **The CAS:** ignoring its result while keeping `FOR UPDATE` writes two
orders for two concurrent «أكّد», verified by breaking it. That one has to be
concurrent *and ordered* — the winner holds its transaction open — because a
sequential double-send never reaches the handler at all: `findActiveSession`
already sees `order_placed`. `cart.test.ts`, `fulfillment.test.ts` and
`cart-review.test.ts` cover the states leading there.

`conversation-engine/test/webhook.test.ts` does the same for the inbound webhook,
which has no guard and no logged-in staff: the tenant comes from a
`phone_number_id`, so the test asserts the message lands under that restaurant
and nowhere else. It needs `ENGINE_DATABASE_URL` (role `sufria_engine`) and uses
`MIGRATION_DATABASE_URL` as a read-only audit connection — the only way to ask
"was a row written to some *other* tenant?", which cannot be asked from inside
RLS.

`conversation-engine/test/notifier.test.ts` covers the notification poller
(brief F §4). Four of its tests are guarded by breaking the code: building the
message from the listing instead of the claim's `RETURNING` drops only the race
test (7); dropping `AND notified = false` from the claim drops only the
two-pollers test (8); dropping the 24-hour window drops only test 11; letting
`pending_acceptance` speak drops only test 6. Test 8 uses two notifier
instances held at a barrier after both listed the order — a single instance
skips its own overlapping tick, and a plain `Promise.all` race passes or fails
by timing. Each notifier in the suite is scoped to the restaurants the test
created (`restaurantScope`, test-only).

`conversation-engine/test/session-timeout.test.ts` covers the session timeout
(brief H §3, tests 1–8, plus 9 for "idle time is the database's clock" and 10
for an expired session at a closed restaurant). A
session is aged with `UPDATE … last_message_at = now() - interval` from the
audit connection. Four breaks, each predicted before it ran: `>=` → `>` drops
only test 3; disabling the expiry step drops 1 and 4–10; letting the new session
copy the abandoned one's `context` drops only 5; measuring idle time with the
injected Node clock drops only 9. **The exact boundary is tested on the pure
`isSessionExpired`, not through the database**: the DB clock moves between
setup and check, so a session aged "60:00" is read at 60:00.05 and expires under
`>` too. Test 7 is ordered like the other concurrency tests — the winner holds
its transaction open, the loser blocks on the expiry CAS. `setup-env.ts` pins
`SESSION_IDLE_MINUTES=60`, so a temporary `1` in `.env` changes nothing here.

Brief م-ج's three suites, each break predicted in a file before it ran:
`dashboard-api/test/staff-messages.test.ts` (POST, resume-bot, the
conversation's staff messages, `botSilence`, `replyOpenUntil`,
`staffMessagedAt`) — its "two presses at once" stops both requests of two
API instances at their INSERT behind a SHARE lock, and its "Node's clock a
month off" fakes `Date` alone in the suite's process, which is the API's;
`conversation-engine/test/bot-silence.test.ts` (the silence's place and what
ends it); `conversation-engine/test/staff-replies.test.ts` (the queue, on
`notifier.test.ts`'s shape, with a sender of its own that returns Meta's id —
the recording fake returns none and is left as it is). One break is not
caught, and is recorded: a claim that reads the row and then writes it,
inside one transaction, passes the two-cycles test — the suite's single
connection runs the two claims one after the other. The deterministic break,
a claim that trusts the listing's read, drops it.

Brief ن's suites: `shared/test/item-notes.test.mts` (the parser's table
§2.2 row by row, §2.3's name rule, §2.4's words, `cleanNote`,
`normalizeWithOrigins`), `shared/test/note-texts.test.mts` (ن1–ن5 letter
for letter, and where they show), `conversation-engine/test/item-notes.test.ts`
(the cart line per (item, note), ن-3's twelve scenarios, the summary, «أكّد»
and «نفسه», on a real database), `dashboard-web/test/orders/notes.test.mts`,
and `test:db` section 12 (0019). Nine breaks, each predicted in a file before
it ran: the key by number alone · the note from the normalized text · the
name taken off word by word · the cart line by `item_id` alone · no §2.4
list · the note on a merged line whole · «آخر إضافة» never emptied · 0019
dropped · the grey line counting every item. Two of `item-parser.test.mts`
changed by Mohammed's decision (19 October): «2 بدون بصل» is now a note and
`parsed`; the «غير واضح» case is text before the first number.

Brief م-هـ-أ's suites: `shared/test/transfer-payment.test.mts` (ن1, §4.3's
table row by row, ن2 letter for letter, ن3) and `shared/test/media.test.mts`
(`mediaFromMessage`, the allowed types, 0021's 5 MiB, an image's size from
bytes written by hand); `conversation-engine/test/transfer-payment.test.ts`
(the summary and «أكّد»), `notifier.test.ts`'s §6.2 block (ten scenarios),
`media.test.ts` (the webhook's row, the queue with a fake downloader, and
`MetaMediaDownloader` against a local `node:http` server — never Meta);
`dashboard-api/test/transfer-media.test.ts`; `test:db` section 13 and the
0021 backfill in `migrate.test.mjs`; gate A20–A23. Ten breaks, each
predicted in a file before it ran: the notice's old value from `RETURNING` ·
the notice not marked at the claim · ن3 for cash too · the payment gate cash
alone · the result written without its attempt · a media row for a message
not relayed · the file without the route's order · `GRANT UPDATE` to the
dashboard · 0021 without its `REVOKE` · the summary ignoring the payment. One
was not caught at first — the stale worker's test let the new worker finish
before the old one came back, so `state = 'pending'` alone refused it; the
test now holds both mid-download. The notifier's `order()` helper builds
`accepted_notice_at` as 0021's backfill would, so a `preparing` order built
by an old test is one whose «أكّدنا» went out a cycle earlier.

🔴 **Never count a whole table in a test** (`SELECT count(*) FROM orders`).
The engine and API suites run in parallel under `pnpm -r test`; count only the
rows of the order or restaurant the test itself created.

## Dashboard structure and the RTL contract (brief I §1–§2, 5 October)

`apps/dashboard-web` is feature-based (Mohammed's decision): `app/` holds the
routes and only composes · `features/auth/`, `features/orders/`,
`features/menu/` — each with its `components/`, `hooks/`, `api/`, `lib/` (pure
functions) — · `shared/` (`ui/`, `layout/` — the header, given its count as a
prop and the pause strip in its `strip` slot; `tabs.ts` marks «المنيو» on
`/menu` and `/menu/removed` — `api/` — the client, the token,
`x-restaurant-id`, the error kinds, the menu's 409 `menu_conflict` — and
`settings/` — the restaurant's currency and `ordersPausedAt` as the one poll
read them: **the pause state lives here**, because two features read it).
Tests in `test/<feature>/`.

1. `app/` composes: it imports from `features/` and `shared/`, with no logic.
2. **No feature imports another.** What two share belongs in `shared/`.
3. `shared/` imports neither `features/` nor `app/`.
4. Logic the API or the engine needs too lives in `packages/shared`.
5. A CSS module sits next to its component; no empty folders.

`test/boundaries.test.mts` fails on an import that breaks 1–3 (break: an
import of `features/auth` inside `features/orders` → caught, by file and line).

Routes: `/` → `/orders` or `/login` · `/login?next=` (a path of this site
alone: `//host`, `https://…`, a backslash or whitespace → `/orders`) ·
`/orders` · `/history` · `/orders/[id]` (`?from=history`) · `/menu` ·
`/menu/removed`. The dashboard pages share `app/(dashboard)/layout.tsx`: the
guard (no session, or a 401 the refresh could not cure — the session store
tells its subscribers — → `/login?next=<page>`; `test/auth/session-end.test.mts`),
the header — two lines since brief ل §5: the mark, the restaurant's name
(19/700, cut with …; not the page's `<h1>`), «مباشر» and «خروج», then the
tabs, the first tab's text on the mark's line (`margin-inline-start: -14px`)
and «الطلبات»'s count 15px on their baseline; «سُفريا» (`T.brand`) stays on
`/login` and the browser's tab alone — and **one** poll of «الطلبات» feeding
both the count and the list
(`features/orders/hooks/live-orders.tsx`). Each tick also reads `GET
/restaurant/settings`, beside the list (brief ي-ب §4), into
`shared/settings/live-settings.tsx`; «أوقف»/«استأنف» write their answer there
at once, and a read sent before that answer does not undo it. While paused,
`features/menu/components/orders-paused-strip.tsx` shows under the header on
every page, above «انقطع الاتصال» — amber since brief ي-ب-9 §4.5 (its own
tokens `paused-bg`/`paused-text`, today «بانتظار القبول»'s values), 16px/700,
the pause sign before its text and «استأنف» right after it. The menu screen
(brief ل §4): on `/menu` and `/menu/removed` alone, «أوقف الطلبات مؤقتا» is
a bar right under the header, outside `<main>` (`pause-box.tsx`: the
surface, a line under it, the page's width inside; gone while paused, the
amber strip in its place, both 65px on a laptop); its hint is two pieces,
`pauseHintLead` and `pauseHintQuote`, the customer's message inline-block.
Then one line: «الأصناف · المُزالة», a view switch (`menu-tabs.tsx`: one
box, the chosen half `--bg-press`, never the accent), and «أضف صنفا» at its
end; «المطفأة» and «شغّل الكل» on a line of their own under it. A card per
category (`.items`), rows a line apart — below 640 with 16px above and under
each (13 October: at 10 the next name sat on the previous item's buttons),
so an item reads as one; a row is two buttons, «أطفئ»/«شغّل»
and «تعديل», «إزالة» being the last button of edit; from 640 the price sits
under the name. A switched-off row is on `--bg`, «مطفأ» inverted (`--bg` on
`--text-primary`) and its «شغّل» inverted too, in that row alone.
«المُزالة» rows have the same structure, the category a badge.

The order's conversation (brief م-د): three voices — the customer at the
start of the line, the bot and staff at its end, staff's bubble dashed
while it goes, filled with `staff-bubble` once sent (dark: a grey, not
white), a 2px line when it failed, and under it the name and time,
«جارٍ الإرسال…», or why with «عدّل وأرسل» (back to the field, never sent
by itself) or «راسل الزبون». Under the list, inside the section
(`staff-composer.tsx`): the silence line with «شغّل الرد الآلي» while the
bot keeps quiet, then the field and «أرسل» (inverted, never disabled;
Enter sends with a mouse, Shift+Enter is a line, touch never); once
`replyOpenUntil` is null, the closed line and «راسل الزبون» instead. The
send is optimistic: a local bubble by `clientId` (a UUID v4 from
`getRandomValues`), retried after 2 s and 6 s, kept until a read brings its
row (`features/orders/lib/reply.ts`). Once the API wrote it, the
conversation is read at once, then **every second while one of the
screen's rows is still `pending`** (`stillSending`, brief م-د-9) — 20
such reads at the most, one clock for the page (a message written while it
runs joins it), stopped by a failed read, the page's leaving or the tab
hidden; the 5 s read goes on regardless. The field grows to 5 lines with
no bar before them: `scrollHeight` is a whole pixel (43.25 reads 43), so
the height is `ceil(scrollHeight + 0.5)` and `overflow-y` is set inline by
the same effect (`fieldHeight`, `fieldOverflow`) — `hidden`, `auto` past
`max-height`. **The step's bar is back in its place in the page only while
the phone's keyboard is really open** (brief م-د-9, decision 5, replacing
the `:focus` rule of م-د): `keyboardOpen` — the field has the focus, the
visual viewport 120px or more shorter than the window, `scale` ≤ 1.01 —
read by `hooks/use-keyboard.ts` on `visualViewport` `resize` and
`focusin`/`focusout`, written as `data-keyboard` on `.page`
(`.page[data-keyboard] .stepBar[data-fixed]`); no `visualViewport`, never.
The back button closing the keyboard brings the bar back, the cursor
still in the field. On touch, after a send with text, the field loses the
focus (`afterSend`); with a mouse it keeps it. **The conversation with the
bot before the order folds** (decision 7): the customer's and the bot's
messages before `order.createdAt`, 4 or more (`FOLD_MIN`), are one line at
the start of the list — «محادثة الطلب مع البوت (24)», its count in `num`,
and «اعرضها»/«اخفِها» (`.action`, `aria-controls` on the group, a `<li
hidden>`); folded on every opening, nothing stored. Staff's bubbles never
fold. `seenUpTo` still reads the server's messages, so the folded ones are
read as before. Its texts are `dashboard-reply-ui.ts`, on the order's page
alone.

**An item's note (brief ن §8, option ب).** On the card, a line with a note
leaves the grey line (`cardView`'s `details` lists the others alone; every
item noted → the kind alone) for a `<p>` of its own under it, inside
`.who` and before the message bubble: «[الاسم] ×[الكمية]» (the quantity
always, `.num`), «ملاحظة:» (`NOTE_LABEL_AR`, 13/600 `text-secondary`) and
the note in a `<bdi dir="auto">` (600, `text-primary`), 15px, wrapping —
never `…`: a note is never cut. 4px under the grey line, 2px between. No
new colour. On the details page the same, without the item, under its line
inside the `li` (`grid-column: 1 / -1`), 2px under it.

**The RTL and width contract, on every file touched** — from 375px to 1440px,
right to left by `dir="rtl"` on `<html>` alone, no horizontal scroll:
- DOM order = reading order = the phone's column. **Never** `row-reverse`,
  `column-reverse` or `order:` to fix a direction: `dir` already flips a row,
  and reversing it on top shows only once the row becomes a column.
- Logical properties only: `margin-inline-*`, `padding-inline-*`,
  `inset-inline-*`, `border-inline-*`, `text-align: start/end`,
  `border-start-start-radius`… — never `left`/`right` in any of them, `float`,
  or the same in `style={{}}` (`marginLeft`…).
- Space between elements is `gap`. Text that can grow inside flex or grid:
  `min-width: 0` and `…`, or a wrap on purpose.
- Numbers (`.num`, isolated), an amount with its currency, the masked number:
  `<bdi>` or `unicode-bidi: isolate`. The customer's words (messages, a
  cancellation reason, an address): `dir="auto"`.
- An icon with a direction mirrors (`:dir(rtl)`): «back» points right.
- **Breakpoints, fixed: 640** (the card: three rows below, one row from it up)
  **· 768 · 1024** (the details: one column below, two from it up) — written
  here and atop `globals.css`, because a CSS variable does not work in `@media`.
- A layout that changes with the width uses `grid-template-areas`, never
  `flex-wrap` and hope: the grid follows `dir`, the wrap follows text length.
- Touch targets 44px at every width.

`pnpm check:rtl` (`scripts/check-rtl.mjs`, in `verify` and a CI step) fails on
the first two items by file and line; a rare exception carries
`rtl-ok: <why>` on its line.

**The size budget (brief I-9b #5, Mohammed, 7 October).** `pnpm check:budget`
builds shared and the app (production, `NEXT_PUBLIC_API_URL` fixed so the
bytes do not move with a machine's `.env`), then `scripts/check-budget.mjs`
reads `.next` and counts, for `/login` · `/orders` · `/history` ·
`/orders/[id]` · `/menu` · `/menu/removed`, what a browser loads before its
first paint: the JS — Next's
root files plus the page's entry chunks (`build-manifest.json`,
`page_client-reference-manifest.js`), gzip, the `noModule` polyfills aside —
and the fonts next/font preloads for the page (`next-font-manifest.json`).
The manifests are checked against the static pages' HTML; a mismatch fails.
It fails when a page passes its numbers in `apps/dashboard-web/perf-budget.json`
— which only come down; up only by Mohammed's decision (`--write` resets
them). Not in `verify` or CI (a build). A server component's imports never
reach the browser and are not counted; a client component's are. It builds
into the same `.next` that `next start` serves: restart a running one after.

## Known gaps

- **`pnpm db:reset` assumes Docker and does nothing useful on a native
  PostgreSQL install.** It runs `docker compose down -v && pnpm db:up`, so
  against a native server on 5432 it tears down a volume nothing uses and then
  fails to bind the port. The native path — terminate connections, `DROP
  DATABASE sufria`, recreate it with the same locale (`TEMPLATE template0
  ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ar-JO' LOCALE 'C.UTF-8'`),
  then `pnpm db:migrate && pnpm db:seed` — is described in prose in
  `docs/02-تجهيز-البيئة.md` but is not automated anywhere. It no longer repeats
  on every new migration — `pnpm db:migrate` applies only the new file to an
  existing database — so it matters only for rebuilding a dev database, and
  never applies to the demo restaurant's.
- **Every mirror lives in `packages/shared`, and `pnpm test:db` now enforces
  that.** It used to iterate the TS schema only, so a SQL table mirrored
  somewhere else was invisible to it — `inbound_messages` sat in
  `apps/conversation-engine/src/db/schema.ts` and went unchecked. That mirror
  moved into `packages/shared`, and the drift check now also walks the
  database's own table list, so a table mirrored nowhere is a failure rather
  than a silent gap. Put new mirrors in `packages/shared`; anywhere else fails.
- `@sufria/conversation-engine` now carries a conversation from the first
  message to a row in `orders`. One handler per state, each the same shape — a
  pure decision plus a thin I/O shell — and the state is only ever in the
  session row:
  `browsing` (`conversation/browsing.ts`) · `fulfillment_choice`
  (`conversation/fulfillment.ts`, two steps in one enum value) · `cart_review`
  (`conversation/cart-review.ts`) · order creation
  (`conversation/order-creation.ts`). Briefs: `docs/11-cart-brief.md` and
  `docs/12-after-cart-brief.md`.
  Writing a new `menu_map` re-checks every cart line's availability live and
  drops what is gone — **the criterion is `is_available`, never absence from
  `menu_map`**, which is authority over numbering alone (cart brief §16). Order
  creation re-checks it again inside its own transaction (cart brief §16.6): a cart can sit
  for minutes, and «منيو» may never come twice.
- **The customer's «استلمنا طلبك» is sent after COMMIT, never inside the
  transaction.** Handlers push onto `ConversationContext.deferred` and whoever
  owns the transaction drains it with `flushDeferred` once it succeeds; a send
  that fails there is logged and the order is left alone. Sending first would
  hand the customer a confirmation for an order that may never be written — and
  a sent WhatsApp message does not roll back. The field is mandatory on purpose:
  an optional one gets forgotten silently, and the customer then orders and
  hears nothing, with no test failing. A test that forces the failure at COMMIT
  (a deferred constraint trigger) is the one that guards this; forcing it
  earlier proves nothing, because the send is never reached.
- **Every state transition is a CAS, and the row lock does not substitute for
  it.** `readSessionData` takes `FOR UPDATE`, but it reads `context` only — the
  state that routed the message was read before the lock, in
  `findActiveSession`. Drop the CAS and two concurrent «أكّد» write two orders;
  verified by breaking it. A *sequential* double-send proves nothing here, since
  routing alone stops the second one.
- **`orders.notified` is written `true` at creation, against its default.**
  `false` means "the poller must send" — the notify loop is part هـ of blueprint
  §6.4, and `idx_orders_unnotified` is built for it — and the engine already sent
  the message itself.
  Deviation recorded in `docs/12-after-cart-brief.md` §12. The poller sends
  nothing for an order in `pending_acceptance` — `statusNotificationAr` returns
  `null` for it, and test 6 of `notifier.test.ts` guards it.
- **`business_hours` has no schema in the database — its contract is
  `docs/10-عقد-ساعات-الدوام.md`.** Migration 0001 declared the column and
  nothing ever wrote a shape into it; the shape is still defined by
  `apps/conversation-engine/src/restaurant/business-hours.ts`, but it is now
  written down for the settings screen instead of being folklore.
  The shape is `{days: {sun: [{open, close}]}}` — **the timezone is no longer
  in it.** Migration 0008 moved it to a real `restaurants.timezone` column,
  backfilled it and stripped the key from every row; a `timezone` key that
  reappears in the jsonb is ignored and logged as a warning. The old rationale
  recorded here — that a new column on `restaurants` would be a schema-drift
  failure — was simply wrong: drift fails when SQL changes and the mirror does
  not, and changing both together is what the check is for. 0007 already said
  so in its own header.
- **A malformed `business_hours` reads as open, not closed.** Deliberate: a
  restaurant that silently stops taking orders because of a broken jsonb loses
  money without knowing, while one that receives a message out of hours sees it
  and acts. The empty field is "always open" by product decision; malformed gets
  the same treatment plus an error log.
  **The dashboard therefore writes the canonical shape alone** (brief D §8.8:
  strict writer, lenient reader): all seven short day keys in every PATCH, a
  closed day as `[]`, `"HH:MM"` with two digits. A week in which the engine
  recognises no day — `{}`, numeric keys, `{from, to}` windows — reads as always
  open, so a near-miss shape makes a closed restaurant take orders, silently.
  - **The 0008 backfill branch has never actually run.** Every seeded row had
  `business_hours = {}`, so the `UPDATE` matched zero rows: the SQL passed, but its
  behaviour on a row that really carries a legacy `timezone` key is unverified.
  No production database exists, so nothing is at risk today. If a legacy database
  ever appears, check it by hand before migrating.
- **`order_placed` is a closed state — and since brief م-أ (Mohammed, 13
  October) a customer's message after an order reaches the restaurant**
  (`conversation/customer-relay.ts`). With no active session, a customer who
  has an order on its way (`pending_acceptance` · `accepted` · `preparing` ·
  `ready`) made less than `RELAY_OPEN_ORDER_MAX_MINUTES` (180) ago, or one
  `completed`/`cancelled` less than `RELAY_CLOSED_ORDER_MINUTES` (60) ago — its
  last history row, else `created_at`, as `status_changed_at` — gets one line
  instead of the menu: a status line per order on its way, oldest first,
  «وصلت رسالتك للمطعم.», «للتواصل مباشرة: …» (none when `contact_phone` is
  NULL) and «لطلب جديد، اكتب «منيو».»; a finished order alone gets «وصلت
  رسالتك للمطعم بخصوص طلبك رقم …» instead of the status and «وصلت». The
  message is linked to the newest order on its way, else the finished one: the
  webhook writes `inbound_messages.order_id` (0016) on its row in the same
  transaction, and the order's conversation shows it (`docs/13` §9.9, rule
  2b). The
  line is not repeated within `RELAY_REPLY_QUIET_MINUTES` (10), whatever the
  statuses do — `customers.relay_replied_at`, read and written under `FOR
  UPDATE` on the customer's row, so two messages at once send one line; the
  messages in between are linked with no reply. It is sent inside the
  message's transaction (a failed send rolls it back) and names its order,
  so `outbound_messages` keeps it under that order. Where it runs: after an
  active session's routing (a customer mid-order carries on as before) and
  **before the hours gate and the pause** — the line, not the closing or the
  paused text. Every time is the database's clock. No session is opened, no
  customer written. One `info` line: restaurant, number masked, order, sent
  or quiet. **Still the menu:** «منيو» (always a new order — `matchCommand`'s
  `menu`) · an order on its way older than 3 hours (forgotten orders are real,
  and FR-13's auto-cancel is not built) · a finished order more than an hour
  ago · a message before any order · `expired`. **A reaction**
  (`message_type = 'reaction'`) is stored and nothing else, first thing in
  `handleInbound`, in every state: no read, no reply, no link, no session or
  `last_message_at` touched, no «not understood» counted. The three
  variables are pinned to their defaults in `setup-env.ts`; the laptop trial
  sets minutes on the command line. `test/customer-relay.test.ts` holds the
  brief's tests 1–22; eight breaks were each predicted before they ran
  (`docs/brief-ma-customer-messages.md`, «كما انبنى»).
- **Staff write to an order's customer (brief م-ج, Mohammed's decisions
  1–14).** The dashboard API writes a `staff_messages` row (0018) and sends
  nothing; the engine's queue (`notify/staff-replies.ts`) claims and sends
  it from the bot's number, as written, at most once — retried after 2 s and
  6 s, Meta's 131047 never retried, and one that waited longer than
  `STAFF_REPLY_MAX_WAIT_SECONDS` before its send began (or sat `sending` that
  long after its claim) failed as `expired`, never sent. **The silence:** the
  bot keeps quiet for a customer while their latest staff message that did
  not fail is younger than its `silence_until` (written by the API on the
  database's clock), unless after it the customer wrote «منيو» or staff
  pressed «رجّع للبوت» (`customers.bot_resumed_at`), or its order was
  completed, cancelled or expired. The rule is `app.bot_silence()` alone —
  no TypeScript copy — read by the engine first thing after a reaction (it
  beats an active session, the timeout, the pause, the hours and the relay;
  the message is linked to the silence's order) and by the API
  (`botSilence`). Status notifications still go out. Four variables:
  `BOT_SILENCE_MINUTES` (60) and `REPLY_WINDOW_MINUTES` (1430, the 24 hours
  less 10 minutes) in the API; `STAFF_REPLY_POLL_MS` (1000 since brief م-د-9, `0` off — one query a
  second on `idx_staff_messages_queue`, whatever the restaurants) and
  `STAFF_REPLY_MAX_WAIT_SECONDS` (120) in the engine, which refuses to start
  when the wait is not more than 3 × `WHATSAPP_SEND_TIMEOUT_MS` + 8000. All
  four pinned in the suites' `setup-env.ts`. **The screen is built**
  (brief م-د — *Dashboard structure*); a pending order staff wrote to
  rings no more (`staffMessagedAt`), its customer's messages still do.
  **Not built:** showing voice notes and images (م-هـ) · «وصلت ✓» (Meta's
  delivery statuses: `wa_message_id` is kept, nothing reads it). A send that went out whose final write then
  failed leaves the row `sending`, to be failed as `expired` — the staff
  member may then send it again. From brief م-د's review: a draft is lost
  when the 24 hours end while staff are still writing (deferred #17) · a
  409 that closed the window followed by a read that still says open shows
  the field, and the text the 409 turned back is shown nowhere · the
  read-only field over the closed line grows with its text on Chrome and
  Edge alone (`field-sizing`) · a network failure on «أرسل» does not bring
  the «انقطع الاتصال» strip by itself. **The keyboard rule (brief م-د-9)
  has not been tried on a real phone** — a headless browser opens no
  keyboard; its decisions are tested as functions alone, the trial is
  after hosting.
- **An active session silent for `SESSION_IDLE_MINUTES` (default 60) or more
  expires lazily, when the next message arrives** (brief H). `handleInbound`
  reads the idle time with the session (`now() - last_message_at`, the
  database's clock), CASes the row to `abandoned` on the state it read, and
  the message continues down the new-session path unchanged — hours gate,
  welcome and menu, empty cart. The old row keeps its `context` and
  `last_message_at`; only `state` changes, which is why this is not
  `advanceSessionState` (it rewrites the timestamp). There is no background
  job: a silent session stays in its state until its customer writes again.
  Consequences worth knowing: an expired session at a **closed** restaurant is
  abandoned and gets the closing text, with no session after it; the timestamp
  is *written* from the Node clock (the injected `now`, or `new Date()` in
  `advanceSessionState`) but *read* against the database's, so the two hosts'
  clocks must agree to within seconds; and two messages straddling the exact
  60:00 mark can let the late one abandon a session the early one just touched
  — the CAS checks the state, not the timestamp, as the brief specified.
- **A status change reaches the customer through the poller, at most once.**
  `PATCH /orders/:id/status` sets `notified = false` and sends nothing; the
  engine's `OrderNotifier` (`src/notify/order-notifier.ts`, brief F) picks it
  up every `NOTIFY_POLL_MS` (default `5000`, `0` turns it off, off in tests) and
  sends one message by status — or none, when silence is the decision
  (`preparing`, `completed`). The claim is `UPDATE … SET notified = true WHERE
  notified = false RETURNING` and the message is built from that row only. It
  commits **before** the send: a crash in between loses the message, by design
  (a duplicate is worse). A failed send is retried twice (2 s, 6 s) and then
  logged at `error` — `notified` stays `true`. Orders older than 23h50m are
  marked without sending: free-form messages need the 24-hour window and there
  are no approved templates. Two statuses between ticks send only the last.
  The engine has no tenant context here, so it lists restaurants through
  `app.restaurants_with_unnotified_orders()` (0012, Bypass #4: `SETOF uuid`,
  `sufria_engine` alone, gate A13–A15) and does everything else in
  `runInTenant`.
- **Nothing updates the customer's statistics on `completed`.** `total_orders`,
  `total_spend`, `last_order_at` and `is_vip` keep their defaults: no code and
  no trigger writes them. SRS FR-14 via FR-13; found in D-7, **undecided** —
  a product call for Mohammed, not a bug to fix in passing.
- **The customer's menu order is written twice** — the ORDER BY in the engine's
  `readMenu` and in `dashboard-api`'s `MenuService` (`customerOrder()`, used by
  the list and by the 4096 guard's read). Changing one does not fail the
  other. The guard's *length* does not depend on it (the categories stay
  contiguous either way); the screen's order does.
- **Every text the engine sends of its own is kept in `outbound_messages`
  (0013), from the day it shipped — nothing before it.** A staff member's
  text is not (brief م-ج): it lives in `staff_messages` alone, sent by the
  queue through the raw sender. One wrapper, `SavingWhatsAppSender`
  (`src/whatsapp/saving-sender.ts`, built in `main.ts`): after a successful
  send, on a `TenantDb` of its own (most replies leave inside the inbound
  transaction, which holds a connection of the engine's pool), with
  `lock_timeout` and `statement_timeout` at 2 s; a failed save is an `error`
  line with the number masked, never a failed reply. `orderId` is set by the
  status notifier, and by the relay line (brief م-أ), which names an order
  committed long before the message's transaction. Never an order the open
  transaction writes itself — its rows are not there for the wrapper's
  connection — and «استلمنا…», sent after COMMIT, carries none either, by
  Mohammed's decision (5 October). `GET /orders/:id/messages` attributes such
  messages by the customer's last message before them — its `order_id` when
  the engine relayed it, else its time. The rules, as built:
  `docs/13-dashboard-api-brief.md` §9.9.
- **The security gate's negative control 2 alters an application role.**
  `tests/security/negative-controls.sh` runs `ALTER ROLE sufria_dashboard
  SUPERUSER` and then `NOSUPERUSER`; roles belong to the Postgres instance, and
  nothing restores the role if the script dies in between. Locally that is the
  test instance's role now (5434, Mohammed's option B, 5 October); in CI it is a
  throwaway instance. **For a later brief, not done (option C):** make the
  control grant SUPERUSER to a role it creates for the run, so the gate never
  alters an application role on any instance.
- **`pnpm -r test` kills the other packages' suites when one fails** (it bails
  on the first failure), so their `afterAll` never runs and their fixtures
  stay in the database — `menu-items.test.ts`'s fixed-id categories then make
  the next run fail on a duplicate key. Found in brief I (5 October): delete
  the leftovers by the killed run's id (`d5-<pid>-<time>` in their names), as
  the test's own `afterAll` would — and never the seed's (`both@`, `onlya@`,
  `onlyz@sufria.test`).
- **`check:budget` is green, by three decisions of Mohammed's (brief
  ي-ب-9, 11 October), brief ل's allowance (12 October: +100 per page,
  +250 on the menu's two) and brief م-أ's decision ج (13 October).** 1A — `main`'s three dashboard budgets up by
  exactly 396 (a Turbopack chunk split since ي-أ/ك, the same code). 2B —
  the menu's texts in `dashboard-menu-ui.ts`, off the pages that do not show
  them. A (§5) — the six budgets to the measure after the design round,
  which passed the 100 per page allowed in advance. JS gzip, over the budget
  after 1A — 2B + design: `/login` +200 + 0 · `/orders` +851 + 107 ·
  `/history` +851 + 107 · `/orders/[id]` +879 + 107 · `/menu` +318 + 284 ·
  `/menu/removed` +290 + 405 (the pause sign on every page; the pause box,
  on «المُزالة» too). Brief ل, over those: `/login` +46 · `/orders`,
  `/history`, `/orders/[id]` +19 · `/menu` +105 · `/menu/removed` +140
  (`withoutZeroCents` on every page, the menu's new structure on its two,
  −23 for the header's class gone). Brief م-أ, decision ج: the relay
  line's texts and `relayLineAr`, with `ALL_CUSTOMER_TEXTS_AR`, in
  `packages/shared/src/relay-line.ts`, off `domain.ts` (which imports
  nothing from it) — every budget down to the measure: `/login` −85, the
  five others −96, the numbered status messages included. What the chunks
  showed: the minifier drops a list of templates nobody reads, but keeps
  each property read in it (`ORDER_STATUS_MESSAGE_AR.accepted`…) as a bare
  expression — it cannot prove a property read pure — so the object read
  stays on every page; and before ج, unused slot constants and the two
  pickup-or-delivery prompts stayed beside them. `ORDER_STATUS_TEXTS_AR`,
  then still in `domain.ts`, kept `ORDER_STATUS_MESSAGE_AR` on every page
  that way, until brief م-ب moved it. The budgets before م-ب: JS `/login` 138760 · `/orders` 146012 · `/history`
  146239 · `/orders/[id]` 149090 · `/menu` 151008 · `/menu/removed` 148920;
  fonts 123204 each. **Brief م-ب left them as they were, red on four pages —
  a decision for Mohammed** (its report and «كما انبنى»): `ORDER_STATUS_TEXTS_AR`
  moved to `relay-line.ts` (−175 · −647 each, as predicted); the live
  list's two (`POLL_MS`, `replaceInActive`) moved to `features/orders/lib/live.ts`,
  so `board.ts` — every card decision — left the menu's pages; the
  messages' texts and the sound's each in a module of their own
  (`dashboard-messages-ui.ts`, `dashboard-sound-ui.ts`): the build keeps a
  module whole, whatever a page reads of it.
  **م-ب، قرار محمد A (17 أكتوبر): الحدود الستة للقياس بعد م-ب-9.** The
  budgets now: JS `/login` 138596 · `/orders` 147988 · `/history` 148138 ·
  `/orders/[id]` 151180 · `/menu` 151676 · `/menu/removed` 149588; fonts
  123204 each. Over `a112d42` (م-ب's end): `/login` 0 · `/orders/[id]` +156
  · the four others +61 — م-ب-9's catch around the player and the message
  ring's gap, in the store every page carries, and the order page's ring.
  **Brief م-د (18 October), within its thresholds, set to the measure:**
  JS `/login` 138628 (+32, the two tokens) · `/orders` 148065 · `/history`
  148215 · `/menu` 151753 · `/menu/removed` 149665 (+77: the tokens, the
  staff 409 in `http.ts`, the ring's condition) · `/orders/[id]` 153975
  (+2795: the field, the line, the staff bubble and their texts); fonts
  123204 each. **Brief م-د-9 (19 October), Mohammed's decision A:**
  `/orders/[id]` 155591 (+1616), the five others unchanged — +177 the fast
  read, +56 the field, +251 the keyboard, +1132 the fold, of which about 444
  is its code and about 688 Turbopack splitting `board.ts` out of the page's
  chunk (one chunk, 28217 bytes / 9060 gzip, became two: 25582 + 4236 /
  8169 + 2023), past the brief's 1500 by that split.
  **Brief ن (19 October), within its thresholds, set to the measure:**
  JS `/login` 138642 · `/orders` 148304 · `/history` 148455 ·
  `/orders/[id]` 155817 · `/menu` 151767 · `/menu/removed` 149679 (+14 on
  every page, +239/+240/+226 on the three that show notes); fonts 123204.
- **Under the pointer and pressed (brief ل §3, decision 2).** Eight tokens
  in `design-tokens.ts`, each named by the ground it changes:
  `surface-hover`/`-press`, `bg-hover`/`-press` (`bg-press` is also the view
  switch's chosen half), `accent-hover`/`-press`, `inverse-hover`/`-press`
  (the inverted «شغّل») — an sRGB mix, recomputed by a test; 56 contrast
  pairs (brief م-ب: `surface` on `text-primary`, the card's count; brief
  م-د: `on-staff-bubble` on `staff-bubble`), the weakest `text-secondary` on light `bg-press`, 4.62. `:hover`
  only inside `@media (hover: hover) and (pointer: fine)` (a phone never
  keeps it after a tap); `:active` on every device; every state of a button
  is written `:not(:disabled, [aria-busy="true"])`, so neither a disabled
  nor a working one changes; the line takes the fill's colour. The header's
  tab under the pointer: primary text and a 2px `--text-muted` line; the
  page's own tab never changes. The order card: `.card:hover:not(:has(.action:hover))`,
  pressed through `.card:has(.open:active)` (`.card:active` never fires
  for a press inside it). A field under the pointer: its line
  `--text-muted`. Timing in `globals.css`: 120ms ease-out, the press at
  once, none under reduced motion; `-webkit-tap-highlight-color:
  transparent`. Held by `test/shared/interaction.test.mts`. A real
  iPhone's `:active` is unverified (React's touch listener on the root
  should cover it).
- **`.00` is dropped from amounts on display alone (brief ل §6).**
  `withoutZeroCents` (`packages/shared/src/domain.ts`, text, never a
  number): «15.00» → «15», «13.50» stays. Two callers only: `formatMinor`
  (every amount in WhatsApp — so the menu-snapshot fixtures carry «15») and
  `amountAr` (every amount on the dashboard). The API's JSON keeps «15.00»;
  the row's edit field starts at «15», and `canonicalPrice` reads the two
  alike, so «حفظ» untouched sends nothing.
- **A customer's voice note, image, video or file is a word, never shown**
  (brief م-ب): «رسالة صوتية — لا تظهر هنا»; a location is «موقع» and a
  Google Maps link. Since brief م-هـ-أ the engine keeps images, audio and
  PDFs (below), and the API serves them — **the screen is brief م-هـ-ب's**:
  until then the dashboard writes the word, as before. The
  location's `payload->'location'` shape is Meta's documented one — no real
  location message exists in the repo to check it; coordinates that are
  not JSON numbers show «موقع» with no link.
- **The alert sound can ring up to a minute late with the tab hidden**
  (brief م-ب, decision 8): the live list polls with the tab hidden
  (`usePolling`'s `whileHidden`, `LiveOrdersProvider` alone), but browsers
  slow a hidden tab's timers to about once a minute. A browser
  notification is after hosting (decision 13). The «browser stopped the
  sound» strip is held by tests of the store, and its look by a stand-in
  `AudioContext`: headless Chromium runs audio whatever the autoplay policy,
  so the real stop is checked on a laptop alone. A player that fails to
  load or throws shows the same strip (brief م-ب-9 §1).
- **The «المتصفح أوقف الصوت» strip does not show on Chrome after login**
  (brief م-ب-9): Chrome takes the login press as the site's permission,
  even after F5 — tried 17 October, in Incognito too. Its real place is
  Safari on an iPad or iPhone, **and it has not been tried there**.
- **A message reaches the dashboard within 0–10 s** (brief م-ب-9): the list
  polls every 10 s, the open order's conversation every 5 s — and that page
  rings too, before it marks the message read; a message rings once
  (`MESSAGE_RING_GAP_MS`, 10 s, in the store). «لحظة بلحظة» — the server
  pushing — is after hosting, by Mohammed's decision.
- **«Read» is per order, on the server** (`orders.customer_messages_seen_at`,
  0017, brief م-ب): opening the order's page marks its customer messages
  read up to the latest it shows, for every device. A closed order with an
  unread message under 24 hours old (the database's clock) is in
  `returned`, not in history's flow; past 24 hours it stays in «السجل» only.
- **The menu list is not polled.** Another device's change to an item shows
  when the screen is opened again; the pause alone is read every tick.
- **A failed «استلمنا طلبك» is never retried.** It is logged, and the order is
  already in the dashboard, so the restaurant still sees it — but the customer
  gets silence after «أكّد». The notify poller does not retry it either: the
  order is written `notified = true`, so the poller never sees it.
- **A closed restaurant answers every message with the closing text** — but a
  customer with an order on its way, or one just finished, gets the relay line
  (brief م-أ, decision 7), and one staff are talking to gets nothing (brief
  م-ج, decision 3). No session is opened by design, so nothing
  remembers that the customer was already told. Rate-limiting that repeat
  belongs with the state machine.
- **The menu is sent whole, in one message.** A menu that exceeds WhatsApp's
  4096-character limit is detected, logged as an error and *not* sent — never
  truncated — and no session is opened, so it recovers by itself once the menu
  is shortened. Paging the menu, or a category-selection step, is a deliberate
  deferral. Since brief ي-أ the dashboard cannot make it too long (the 4096
  guard, below); the engine's check stays the net for a menu written any other
  way.
- **The menu's message is built in `packages/shared`** (`menu-message.ts`,
  brief ي-أ §3): `renderMenuText`, `firstMenuMessageAr` (welcome + `"\n"` +
  menu), `WHATSAPP_TEXT_LIMIT` and `whatsappTextLength` (`[...body].length`).
  The engine sends it, and the API's guard measures it, with the same
  functions. Its every character is pinned by
  `conversation-engine/test/menu-snapshot.test.ts`, which asks `handleInbound`
  on a real database and compares with `test/fixtures/menu-snapshot/*.txt` —
  generated from the engine's code before the move, and untouched by it.
  Changing the text on purpose means regenerating those fixtures in the same
  commit.
- **Orders can be paused** (`restaurants.orders_paused_at`, 0014; brief ي-أ,
  Mohammed's decisions 1–3). While set, every message gets
  `ORDERS_PAUSED_AR`, the one text, and nothing is written — but a customer
  with no active session and an order on its way, or one just finished, gets
  the relay line (brief م-أ). The order in `handleInbound`: a reaction (stored,
  nothing else, brief م-أ) → **the silence for staff (brief م-ج)** → the
  session timeout (H) → **an active session
  while paused: the text, before any routing** — «أكّد» included, so no order;
  the session untouched, not even `last_message_at` → routing → **the relay
  (brief م-أ)** → the hours gate (closed beats paused for a new
  conversation: its text carries the hours) →
  **a new conversation while paused: the text, no session** → `prepareMenu`.
  One `info` line per such reply: restaurant, `reason` (`paused` or
  `empty_menu`), number masked. Written by `PATCH /restaurant/orders-pause`
  (pausing again keeps the first moment); read with every message, so it
  applies from the next one.
- **A menu with no item to show is the paused text** (decision 3), by the
  menu's own criterion — no line came back from `readMenu` (an available item
  in an active category), never a second count. A new conversation gets
  `ORDERS_PAUSED_AR` and no session (`empty_menu`); «منيو» in a session gets
  it too, and the session is not written — the menu is now prepared before
  the session write, so the cart is not pruned either.
- **Archiving is a constraint, not engine code.** `menu_items.archived_at`
  (0014) with `CHECK (archived_at IS NULL OR is_available = false)`: an
  archived item is never available, so every engine path that reads
  `is_available` — the menu, every add, every new `menu_map`, the «أكّد»
  re-check — treats it as a switched-off one, and no engine line knows the
  column exists. «Removed from the menu» is archived, never deleted
  (decision 4); `archived: false` brings it back switched off. The API turns
  any change to an archived item but `archived: false` into a 409
  `item_archived` — the constraint's own refusal included, never a 500.
- **The 4096 guard** (`dashboard-api`, `MenuService.guarded`; brief ي-أ §5).
  On `POST /menu-items`, a `PATCH` with `name`, `price` or
  `isAvailable: true`, and `enable-all`: inside the change's own transaction,
  the first message — the welcome with the restaurant's name, and the menu —
  is built before and after from the database with the shared functions and
  counted as WhatsApp counts; **longer than 4096 and longer than before** →
  rollback and a 409 `menu_too_long` with `length` and `limit`. «Longer than
  before» lets a menu already too long (the setup script does not check)
  take any change that does not lengthen it, and recover by shortening.
- **A pause saved in the very millisecond «أكّد» writes its order can let that
  one order through.** The engine reads `orders_paused_at` at the start of the
  message's transaction; a pause committed after that read does not stop it.
  Known and accepted (brief ي-أ §4) — no lock was added for it.
- **Two menu edits committed at the same moment can each pass the 4096 guard
  and pass it together.** Each transaction measures its own change, not the
  other's uncommitted one; no lock serialises menu edits, in the spirit of the
  pause race above. The engine's check still refuses to send such a menu, and
  the next edit that shortens it is accepted.
- **The setup script does not check the 4096 limit** (brief ي-أ §9: out of
  scope). A menu file can still produce a first message the engine refuses to
  send; the guard then accepts every edit that shortens it.
- **A pause longer than `SESSION_IDLE_MINUTES` ends the sessions of customers
  who write during it.** The paused reply does not touch `last_message_at`
  (decision 1) and the timeout runs first (H), so a customer whose last
  message before the pause is over an hour old gets their session abandoned
  — the cart stays in that row — and, once orders resume, starts over with
  the menu. Both rules are the briefs'; this is what they add up to.
- **«آخر طلب لك» — the reorder suggestion (FR-08, brief ك).** A new
  conversation, past the relay (brief م-أ) and the hours and pause gates —
  «منيو» as a first message is one — reads the customer's last
  order the restaurant accepted (`accepted` · `preparing` · `ready` ·
  `completed`) and puts it between the welcome and the menu, at today's
  names and prices, in today's menu order; an item off today is named on
  the existing «غير متوفر الآن» line, and none available means no block.
  It is shown on the first message alone — never on «منيو», never in an
  active session — and kept in `context.reorder` by `deliverMenu`, in the
  write of `menu_map`. «نفسه» («نفسو», «نفس الطلب») acts in `browsing` with
  an empty cart and a kept suggestion: availability re-checked live, the
  cart at the moment's prices, then the very «تم» branch (`checkout`);
  otherwise it is plain text on the old path. What to know:
  - **The age is `REORDER_MIN_AGE_MINUTES`** (engine `env.ts`, default
    `180`, pinned to `180` in `setup-env.ts`): no block while the customer
    has any order not `cancelled`/`expired` younger than that — measured
    with the database's `now()`, like the session timeout. `1` is for the
    laptop trial, set on the command line, not in `.env`.
  - **Past 4096 the block is dropped, not the menu.** The first message
    with the block is measured; too long, the plain one goes out, nothing is
    kept for the suggestion, and one `info` line says so. The dashboard's
    4096 guard measures the plain message only, so a menu near the limit
    silently stops showing suggestions — visible in the logs alone.
  - **The address and the way of pickup are not reused**: after «نفسه» the
    customer is asked as after «تم» (brief ك §9).
  - **«نفسه» is a browsing command word**, so at the address step it is
    «not an address», like «تم» or «منيو»: the question again. It used to
    be saved as the address.
  - Index `idx_orders_customer_recent` (0015) serves both queries;
    `test/reorder.test.ts` holds the brief's 20 cases, and eight breaks were
    each predicted before they ran (`docs/brief-ka-reorder.md`, «كما انبنى»).
- **Item notes — «2 بدون بصل» (brief ن, Mohammed's decisions 1–11, 19
  October).** `order_items.notes` (0001) is written at «أكّد» since brief ن;
  0019 holds it to 1–100 characters or NULL.
  - **The parser** (`item-parser.ts`): the raw text after an item's number —
    and its quantity — up to the next number is that line's note; text
    before the first number is «غير واضح» as before; a number off the menu
    takes its note with it. Cut from the customer's own text through
    `normalizeWithOrigins` (`normalize.ts`), which `normalizeArabic` is now
    built on — one normalization, with where each character came from.
    Separators off the note's two ends, kept inside; finish words off its
    end («2 بدون بصل تم» does not finish). Lines merge by (number, note
    normalized): «2 بدون بصل 2» is two lines; the cap is on the item whole.
  - **The item's name is not a note** (`noteWithoutName`, in the engine
    where the name is known): words off the note's start while they equal
    the name's, in order; a negation word (`بدون` · `بلا` · `بلاش` · `غير`
    · `من`) never goes — «3 قهوة بدون هيل» on «قهوة بدون سكر» keeps «بدون
    هيل».
  - **The cart** is a line per (`item_id`, note normalized), the first text
    kept; a note over 100 after the name → the item is not added (ن4أ).
    «شيل 2» takes every line of 2. An item off is named once. A line with
    no note is **written** with no `note` key (`writeSessionData`), so a
    session without notes is exactly as before; reading defaults it `null`.
  - **A note in a message of its own** sticks only when `context.last_added`
    — what the previous message added — holds exactly one line, and the
    message is no command (browsing's or the steps after), no word of
    reply (`REPLY_WORD_INPUTS`, §2.4, Latin without case), not empty once
    normalized. It goes to the pieces that message added alone (a merged
    line is split, at its own price); a second joins with «، ». Every
    other message empties `last_added`. ن5 («للملاحظة، اكتبها بعد رقم
    الصنف…») once a session (`note_hint_sent`), with «غير مفهوم» or «غير
    واضح», only with a cart, never for a reply word, an empty message or a
    command word read as text.
  - «آخر طلب لك» groups by (item, note) and «نفسه» copies the notes; the
    summary shows them. **Limits, accepted:** a note after «تم» is lost (the
    way back: «عدّل» · «شيل 2» · «2 بدون بصل», or a message after the order)
    · a number inside a note starts an item («2 مع 2 خبز»; the summary shows
    it) · no note for the whole order · the restaurant cannot refuse or edit
    a note · two messages arriving out of order: the note does not stick ·
    «تمام» after an add is «غير مفهوم» and counts toward the handoff · a
    summary with 100-character notes passes 4096 at about 29 noted lines
    (21 with long names, delivery and a 300-character address) · a session
    left untouched (the paused text, «منيو» on an empty menu, the silence)
    keeps its `last_added`, so a note after it can stick to the line before.
- **The transfer payment and a customer's media (brief م-هـ-أ, Mohammed's
  decisions 1–8, 20 October).** One payment method per restaurant
  (`restaurants.payment_method`, cash or transfer, and its own
  `transfer_details`), never asked of the customer: a transfer restaurant's
  summary says ن1, «أكّد» writes `transfer`/`pending_transfer`, «اقبل» sends
  ن2 (where to transfer, the total with the fee), «ابدأ التحضير» sends ن3
  (`RELAY_STATUS_LINE_AR.preparing` — the written decision that lifts the
  `preparing` silence, for transfer orders alone), and «تم» writes
  `collected`, like cash — no gate, staff check the wallet. **The notifier
  remembers the accepted message** (`orders.accepted_notice_at`, marked at
  the claim, its old value read from the claim's CTE): a `preparing` order
  whose accepted message never went — «اقبل» then «ابدأ» inside one cycle —
  gets the accepted message instead (cash too, «أكّدنا» used to be lost).
  The settings are set by `scripts/demo-payment.mjs` until the settings
  screen. **Media:** a customer's image, voice note or PDF on a message
  relayed to an order (the relay or the silence) gets a `pending`
  `inbound_media` row in the webhook's transaction; the engine's queue
  (`MEDIA_POLL_MS`, 2000) downloads it from Meta — a claim is a 120 s lease,
  the result guarded by its attempt, retried after 30 s, 2 min, 10 min, an
  hour, 6 hours, then `failed`; older than 7 days `failed` with no request;
  over 5 MiB `too_large`, never downloaded. What to know:
  - **The host must reach Meta's file domain** (`lookaside.fbsbx.com`), not
    `graph.facebook.com` alone — for the hosting brief. Meta's real answers
    are unverified: the downloader was tried on a local server alone.
  - **The screen is not built** (brief م-هـ-ب): the image, the player, the
    PDF, the payment badge, the «ابدأ التحضير» text for a transfer order.
  - **Not built:** deleting media after a while (a customer's financial
    data) · cancelling a transfer order never paid · linking a media sent
    before «أكّد» to the order · media before 0021 (never fetched again) ·
    video and files other than PDF · thumbnails · `refunded` · a gateway ·
    staff sending media · understanding a voice note.
  - **Accepted limits:** a voice note mid-cart is «غير مفهوم» and never
    reaches staff · «اقبل», «ابدأ» and «جاهز» all inside 5 s send «جاهز»
    alone · a customer who transferred before acceptance gets ن2's
    «حوّل» (may transfer twice) · a cancellation after a transfer is
    refunded by hand · a customer who paid cash at a transfer restaurant is
    recorded transfer · WhatsApp voice notes (Opus) on iOS before 18.4 are
    not guaranteed to play (for the screen).
  - A message's media is served as the MIME type the webhook carried, and a
    row whose type is not allowed for its kind is failed before Meta is
    asked; Meta's own answer is checked too.
- **A split shift shows only its first window** in the closing message: the text
  has two slots, not four. Showing the *next* window would be a computed promise,
  which is the thing that text deliberately avoids.
- **Per-restaurant message text (`message_templates`) is deferred, not rejected.**
  The table exists since 0001 with `restaurant_id NULL` meaning a platform
  default, but nothing reads it. Customer-facing Arabic lives in
  `packages/shared/src/domain.ts` instead (the relay line's in
  `relay-line.ts`, brief م-أ). Letting each restaurant edit its own
  wording is not needed in Sprint 1 or 2, costs a read per message and a
  migration per wording change, and works against the decision that the
  templates keep one voice that suits both an upmarket restaurant and a shawarma
  counter.

---

## قبل أي سطر كود — قواعد قراءة البريف

🔴 **أي جملة في أي بريف تصف هذا الريبو — ملف موجود، دالة موجودة، عمود موجود،
مسار كذا — هي افتراض من كاتب البريف، لا حقيقة.** تحقّق منها بنفسك أولا.

🔴 **إذا خالف الواقعُ البريفَ: قف واذكر الفرق.** لا تكمّل على أيهما، ولا تُصلح
البريف ضمنا.

🔴 **إذا تعارضت تعليمتان في البريف: قف واسأل.** لا تختر واحدة بنفسك.
حصل ثلاث مرات في يوم واحد: (١) «اختبارات حقيقية» مع «ممنوع dependencies»،
(٢) مسار مخالف لوثيقة Sprint 1، (٣) «النصوص من shared» مع «ممنوع تضيف فيها».

🔴 **إذا كان سؤالك التقني يخفي خلفه قرار منتج أو معمارية — سمِّ القرار صراحة
في سؤالك.** ثلاثة قرارات كادت تُتخذ ضمنا داخل أسئلة صياغة: نص مرقّم مقابل قائمة
تفاعلية · وقت محسوب مقابل حقيقة مخزّنة · سلوك القائمة الطويلة.

🔴 **النصوص العربية الظاهرة للمستخدم لا تُخترع ولا يُعاد صياغتها.** تُطلب من
محمد حرفيا، وتُنسخ كما هي.

## ملكية الموارد — يحدّدها كل بريف صراحة

`pnpm-lock.yaml` · `package.json` · `packages/shared` · رقم الهجرة التالي.
**البريف الذي لا يحدّدها يُسأل عنها قبل البدء، لا يُفترض.**

---

## شروط الإنجاز — إلزامية لكل مهمة

**محمد هو اللي بيجرّب على اللاب وبيدمج بـ`--no-ff`، مش الجلسة** (قرار محمد، 13
أكتوبر: هيك صار الشغل فعليا من ط-9، وكل بريف كان يلغي الشروط القديمة). المهمة
لا تُحتسب منجزة إلا إذا:
1. الشغل مكوَّم **ومرفوع على فرع المهمة** (`origin/<الفرع>`)، و`git status --short`
   فاضي. **بلا PR وبلا دمج على `main`**، إلا إذا البريف طلب غير هيك.
2. `set -a && . ./.env.test && set +a && pnpm verify` = 0 على آخر كوميت.
3. `pnpm check:budget` أخضر، أو الفرق مكتوب بالتقرير كقرار لمحمد.
4. أي سكربت اختبار كان `echo` وله علاقة بشغلك يُستبدل باختبار حقيقي.
5. التقرير حسب البريف، وبآخره حرفيا وبلا تلخيص: ناتج
   `git status --short && git log --oneline -15`، وآخر 15 سطر من `verify`.
6. **خطوات اللاب بالتقرير بتفتح الفرع بـ`git switch --detach origin/<الفرع>` بنسخة
   `~/sufria`**، مش بـ`git worktree add`: الفرع مفتوح بـworktree الجلسة، فالأمر بيفشل
   (صار بتقرير ل، 12 أكتوبر).

الـworktree تبع الجلسة بيضل لحد الدمج، وبعده محمد بيشيله (`git worktree remove`).
والإنجاز الحقيقي هو الدمج على `main`: دليله ناتج أمر على `main` بعد الدمج، مش تقرير
الجلسة (القاعدة تحت).

🔴 **كوميت بعد كل بند ينجح اختباره — لا تجميع للنهاية.**
ضاعت محاولة كاملة: امتلأ القرص أثناء استعادة المصادر بعد اختبار الكسر، فمُسح 13 ملفا
وكلها كانت غير مكوَّمة. الكوميت المؤقت رخيص، والجلسة المعلّقة تأخذ كل غير المكوَّم معها.

🔴 **لا تشغّل اختبارات قاعدة البيانات بالتوازي مع جلسة أخرى.**
بعضها يأخذ `ACCESS EXCLUSIVE`، والتوازي = تعليق أبدي بلا رسالة خطأ.

🔴 **تحقّق من المساحة قبل البدء: `df -h /`**
والقرص الذي يمتلئ على WSL هو قرص ويندوز المضيف، لا لينكس — والعرَض `Input/output error`.

🔴 **تقرير الوكيل عن نفسه ليس دليلا. الدليل الوحيد ناتج أمر على `main`.**
حصل ثلاث مرات: رينيم Sufria، وB0، وتقوية المستقبِل — كلها كانت "خالصة" وهي غير مكوَّمة،
والتقارير كانت دقيقة وصحيحة، والشغل لم يكن على `main`.

## قرارات مقفولة — لا تُعاد مناقشتها

- 🔴 **الاختبارات على اللاب دايما بـ`.env.test` — ممنوع تشغيلها بدونه.** `.env` بيأشّر على قاعدة مطعم
  العرض الحقيقية، و`.env.test` على نسخة Postgres الاختبارات (منفذ 5434) بأدوارها وكلمات سرها
  (قرار محمد، 5 أكتوبر). الأمر: `set -a && . ./.env.test && set +a && pnpm verify`.

- **Drizzle** (ADR-001) · **Zod** (ADR-003)
- **Jest + ts-jest** — لا Vitest ولا esbuild ولا SWC (ADR-004).
  السبب: esbuild لا يدعم `emitDecoratorMetadata`، وNest يقرأ `design:paramtypes`
  للحقن بالنوع. بدونه **الحقن يصير `undefined` بصمت** — وقد حصل فعلا.
- **Meta Cloud API مباشرة** — لا BSP ولا 360dialog.
- **الهجرات إضافة فقط.** ممنوع تعديل هجرة مطبَّقة. أي تغيير بهجرة جديدة.
- **الأرقام غربية فقط** (0-9). ممنوع الخلط. البوابة `pnpm check:numerals` (`scripts/check-numerals.mjs`،
  جزء من `pnpm verify` وخطوة CI): كل نص مصدَّر من `@sufria/shared` وكل ملف مكتوب باليد في `dashboard-web`.
  **لا تفحص** مصدر `shared` نفسه — `normalize.ts` يحمل `٠-٩` بقصد لتطبيع مدخلات الزبون. ما عدا ذلك
  (المحرّك، الـAPI): افحص يدويا.
- **الخطوط:** IBM Plex Sans Arabic للنص · IBM Plex Mono للأرقام. Almarai مشطوب.
  أوزانها وpreload وطريقة تحميلها قرار تصميم مع محمد — ولا تغيير بلاه (بريف ط-9ب).
- **قاعدة الأداء — قرار محمد، 7 أكتوبر (بريف ط-9ب §3):**

  | نوع الصفحة | الهدف |
  |---|---|
  | **الصفحات العامة** (الموقع، وصفحة «منيو برابط» إذا انبنت) | Lighthouse **100** تلفون ولابتوب |
  | **تحميل اللوحة** (ومنها `/login`) | تلفون **≥ 90** · لابتوب **≥ 95** هلق، و**100** بعد الاستضافة |
  | **تفاعل اللوحة** | **INP ≤ 200ms** على معالج ×4 للأفعال الأساسية |
  | **كل الصفحات** | **حد حجم ثابت** (`check:budget`): ما بيطلع، وكل تحسين بينزّله |

  **مؤجّل للاستضافة:** الـAPI على نفس الدومين (بيشيل طلب الـpreflight) · الجلسة بكوكي httpOnly عشان
  السيرفر يرسم البيانات (أداء وأمان). 🔴 ممنوع الحيل: أي تعديل بيرفع الرقم بلا ما يحسّن إشي حقيقي.
- **لون البراند:** سُمّاق `#75284A` فاتح / `#B54874` غامق. الألوان كلها في `packages/shared/src/design-tokens.ts`
  وحده، ومنه تتولّد متغيّرات CSS. البوابة `pnpm check:contrast` (جزء من `pnpm verify` وخطوة CI) تعدّد الأزواج
  منه — كل نص فوق كل خلفية يقع عليها، وكل شارة، بالوضعين — بحدّ 4.5:1.
  🔴 `text-muted` (فاتح) و`accent` (غامق) **ليسا لونَي نص**: 3.23:1 و3.26:1.
- **قاعدة رد الـwebhook — لا تُعكس أبدا:**
  `200` = خُزّنت بأمان، أو تُجوهلت بقصد ونهائيا (JSON مشوّه، نوع غير مدعوم).
  **غير `200`** = لم أستطع — أعِد الإرسال.
  ميتا تعيد الإرسال بتردد متناقص **حتى 7 أيام** على أي رد غير `200`، فهي طابور
  إعادة مجاني. الرد بـ`200` على فشل تخزين يضيّع رسالة زبون **نهائيا**.
  ممنوع الرجوع إلى «200 دائما».
- **`/health` يلمس قاعدة البيانات.** بدونه تبقى عملية بقاعدة واقعة "سليمة"
  وتبلع كل الرسائل وترد `200`.
- **مسار المستقبِل `/webhooks/whatsapp`** — لا `/webhook`.
- **المنيو واختيار الأصناف: نص مرقّم، لا قائمة تفاعلية (Interactive List).**
  حدّان صلبان من ميتا: 10 صفوف إجمالا و24 حرفا لعنوان الصف — أي منيو حقيقي يكسرهما.
  والأهم منتجيا: النص الحر يسمح بـ«2 و5» و«شاورما ×2 بدون بصل» — وهو ما لا تستطيع
  القائمة التفاعلية التعبير عنه إطلاقا. هذا ما يجعل السلّة ممكنة أصلا.
  **غير مشمول:** الاختيارات القصيرة (أكّد/عدّل/ألغِ · توصيل أم استلام · طريقة الدفع)
  — قرار منفصل لم يُتخذ بعد، وReply Buttons (3 كحد أقصى) مرشّح واقعي هناك.
  **ما يعيد فتحه:** أن يفشل زبائن البايلوت فعليا في الرد برقم.

## مصائد ممنوع فتحها

- **إعادة توليد مخططات `.png`** — `mmdc` يجرّ Puppeteer/Chromium ويفشل على WSL. مصيدة وقت مسجّلة.

🔴 **سكربت اختبار الكسر يسترجع الملف المكسور وحده — ممنوع `git checkout -- .` وممنوع `git checkout HEAD -- .`**
مسح تعديلات غير مكوَّمة فعلا. وتكرّر اليوم: وكيل استعمل `HEAD -- .` لأن القاعدة لم تكن مكوَّمة، فلم يرها الـworktree تبعه.

## أسلوب العمل

- اشرح الفكرة بلغة بسيطة **قبل** الأمر · أمر واحد كل مرة · اختصر.
- **تحقّق قبل أن تقول.** إذا لم تستطع، قل «غير متحقَّق منه» صراحة.
- لا تقدّم استنتاجا بثقة حقيقة متحقَّق منها.
