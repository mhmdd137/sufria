/**
 * A customer's messages on the dashboard (brief م-ب §6): the card's bubble
 * and count, the returned group, the conversation's messages with no text,
 * and when the page marks them read. The decisions are the pure functions of
 * `board.ts` and `details.ts`; what only a browser would show is held by
 * reading the TSX and the CSS, as card.test.mts does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  CustomerOrBotMessage,
  OrderListItem,
  OrderMessage,
} from "@sufria/shared";
import { cardView } from "../../features/orders/lib/board.ts";
import {
  MESSAGES_POLL_MS,
  conversationView,
  newCustomerMessage,
  seenUpTo,
} from "../../features/orders/lib/details.ts";

const COMPONENTS = fileURLToPath(
  new URL("../../features/orders/components/", import.meta.url),
);
const read = (file: string) => readFileSync(`${COMPONENTS}${file}`, "utf8");

/** The declarations of one CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

const NOW = Date.parse("2026-10-15T12:00:00.000Z");

const ORDER: OrderListItem = {
  id: "22222222-2222-4222-8222-222222222222",
  orderNumber: 230,
  status: "accepted",
  fulfillmentType: "pickup",
  total: "6.00",
  itemCount: 1,
  createdAt: "2026-10-15T11:40:00.000Z",
  customer: { name: null, phone: "+962790001234" },
  items: [{ name: "شاورما", quantity: 1, note: null }],
  statusChangedAt: "2026-10-15T11:41:00.000Z",
  cancellationReason: null,
  unreadMessages: 0,
  lastMessage: null,
  staffMessagedAt: null,
};

const unread = (
  count: number,
  last: OrderListItem["lastMessage"],
): OrderListItem => ({ ...ORDER, unreadMessages: count, lastMessage: last });

// --- the card ---------------------------------------------------------------

test("🔴 the card: no unread message, no bubble — even with a last message, read", () => {
  assert.equal(cardView(ORDER, "active", "JOD", NOW).message, null);
  assert.equal(
    cardView(unread(0, { kind: "text", text: "شكرا" }), "active", "JOD", NOW)
      .message,
    null,
  );
});

test("the card: the latest text, as written, with the count", () => {
  assert.deepEqual(
    cardView(
      unread(3, { kind: "text", text: "وين طلبي؟" }),
      "active",
      "JOD",
      NOW,
    ).message,
    {
      text: "وين طلبي؟",
      word: false,
      count: "3",
      label: "رسائل جديدة: 3",
    },
  );
});

test("the card: a voice note is its word, «رسالة صوتية», in grey — no «لا تظهر هنا»", () => {
  assert.deepEqual(
    cardView(unread(1, { kind: "audio", text: null }), "active", "JOD", NOW)
      .message,
    { text: "رسالة صوتية", word: true, count: "1", label: "رسائل جديدة: 1" },
  );
  assert.equal(
    cardView(unread(1, { kind: "location", text: null }), "active", "JOD", NOW)
      .message?.text,
    "موقع",
  );
});

test('the card\'s TSX: the bubble is a <bdi dir="auto">, the count carries its label', () => {
  const tsx = read("order-card.tsx");
  assert.match(
    tsx,
    /<bdi\s+dir="auto"[\s\S]*?\{view\.message\.text\}\s*<\/bdi>/,
  );
  assert.match(tsx, /aria-label=\{view\.message\.label\}/);
  assert.match(tsx, /className=\{`num \$\{styles\.unread\}`\}/);
});

test("the card's CSS: the customer bubble's look, one line; the count inverted, 24px, 999px", () => {
  const css = read("order-card.module.css");
  const bubble = rule(css, ".bubble");
  for (const d of [
    "background: var(--bg);",
    "border: 1px solid var(--border);",
    "border-radius: 12px;",
    "font-size: 15px;",
    "white-space: nowrap;",
    "text-overflow: ellipsis;",
    "min-width: 0;",
  ])
    assert.ok(bubble.includes(d), `.bubble: ${d}`);
  const word = rule(css, ".word");
  for (const d of [
    "font-size: 13px;",
    "font-weight: 600;",
    "color: var(--text-secondary);",
  ])
    assert.ok(word.includes(d), `.word: ${d}`);
  const count = rule(css, ".unread");
  for (const d of [
    "height: 24px;",
    "border-radius: 999px;",
    "background: var(--text-primary);",
    "color: var(--surface);",
    "font-size: 13px;",
    "font-weight: 600;",
  ])
    assert.ok(count.includes(d), `.unread: ${d}`);
});

// --- the returned group -----------------------------------------------------

test("a returned card: its badge, no button, its reason — and it opens without ?from=history", () => {
  const cancelled: OrderListItem = {
    ...unread(1, { kind: "text", text: "ليش؟" }),
    status: "cancelled",
    cancellationReason: "نفد الخبز",
  };
  const view = cardView(cancelled, "returned", "JOD", NOW);
  assert.equal(view.action, null);
  assert.equal(view.badge, "ملغى");
  assert.equal(view.reason, "نفد الخبز");
  assert.equal(view.href, `/orders/${cancelled.id}`);
  assert.equal(view.message?.text, "ليش؟");
});

test("the group shows only with returned orders, above the queue, under its title", () => {
  const tsx = read("active-orders.tsx");
  assert.match(tsx, /returned\.length > 0 &&/);
  assert.match(tsx, /\{M\.returned\}/);
  assert.match(tsx, /place="returned"/);
  assert.ok(
    tsx.indexOf('place="returned"') < tsx.indexOf('place="active"'),
    "the group comes before the queue",
  );
  const title = rule(read("order-list.module.css"), ".groupTitle");
  assert.ok(title.includes("font-size: 15px;"));
  assert.ok(title.includes("font-weight: 700;"));
});

// --- the conversation -------------------------------------------------------

const msg = (
  kind: OrderMessage["kind"],
  extra: Partial<CustomerOrBotMessage> = {},
): OrderMessage => ({
  id: `m-${kind}`,
  direction: "inbound",
  kind,
  text: kind === "text" ? "مرحبا" : null,
  location: null,
  at: "2026-10-15T11:50:00.000Z",
  ...extra,
});

test("the conversation: every kind by its word; «— لا تظهر هنا» after four of them", () => {
  const view = conversationView([
    msg("text"),
    msg("audio"),
    msg("image"),
    msg("video"),
    msg("document"),
    msg("other"),
  ]);
  assert.deepEqual(
    view.messages.map((m) => [m.text, m.word, m.map]),
    [
      ["مرحبا", null, null],
      [null, "رسالة صوتية — لا تظهر هنا", null],
      [null, "صورة — لا تظهر هنا", null],
      [null, "فيديو — لا تظهر هنا", null],
      [null, "ملف — لا تظهر هنا", null],
      [null, "رسالة لا تظهر هنا", null],
    ],
  );
});

test("the conversation: a location is «موقع» and its map link; without a point, the word alone", () => {
  const [withPoint, without] = conversationView([
    msg("location", {
      id: "a",
      location: { latitude: 31.9539, longitude: 35.9106 },
    }),
    msg("location", { id: "b" }),
  ]).messages;
  assert.equal(withPoint!.word, "موقع");
  assert.equal(withPoint!.map, "https://www.google.com/maps?q=31.9539,35.9106");
  assert.equal(without!.word, "موقع");
  assert.equal(without!.map, null);
});

test("the conversation's TSX: the map opens in a new tab, «افتح الخريطة», 44px to press", () => {
  const tsx = read("conversation.tsx");
  assert.match(
    tsx,
    /href=\{m\.map\}\s+target="_blank"\s+rel="noopener noreferrer"/,
  );
  assert.match(tsx, /\{M\.openMap\}/);
  const css = read("conversation.module.css");
  assert.ok(rule(css, ".map").includes("min-height: 44px;"));
  const word = rule(css, ".word");
  assert.ok(word.includes("font-size: 13px;"));
  assert.ok(word.includes("color: var(--text-secondary);"));
});

test("the conversation is read every 5 seconds (decision 11)", () => {
  assert.equal(MESSAGES_POLL_MS, 5_000);
});

// --- read ---------------------------------------------------------------------

test("«read» is sent only for a customer message newer than the last one marked", () => {
  const bot: OrderMessage = {
    ...msg("text"),
    id: "bot",
    direction: "outbound",
  };
  const first: OrderMessage = { ...msg("text"), id: "c1" };
  const second: OrderMessage = { ...msg("audio"), id: "c2" };

  assert.equal(seenUpTo([], null), null, "no messages");
  assert.equal(seenUpTo([bot], null), null, "the bot's alone");
  assert.equal(seenUpTo([first, bot], null), "c1", "the first read");
  assert.equal(seenUpTo([first, bot], "c1"), null, "nothing new");
  assert.equal(seenUpTo([first, bot, second], "c1"), "c2", "a new one");
});

// --- the order's page rings (brief م-ب-9 §2, tests 1–4) -----------------------

test("the order's page rings for a customer message the previous read did not have", () => {
  const hello: OrderMessage = { ...msg("text"), id: "c1" };
  const again: OrderMessage = { ...msg("text"), id: "c2" };
  const bot: OrderMessage = { ...msg("text"), id: "b1", direction: "outbound" };

  assert.equal(newCustomerMessage(null, [hello]), false, "1: the first read");
  assert.equal(newCustomerMessage([hello], [hello]), false, "2: the same");
  assert.equal(
    newCustomerMessage([hello], [hello, again]),
    true,
    "3: a new one",
  );
  assert.equal(
    newCustomerMessage([hello], [hello, bot]),
    false,
    "4: the bot's alone",
  );
});
