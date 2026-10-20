/**
 * Item notes on the card and the details page — brief ن §8 (option ب). What
 * the card shows is `cardView`'s; how it shows it is read from the TSX and
 * the CSS, since `node --test` renders nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NOTE_LABEL_AR,
  type OrderDetail,
  type OrderListItem,
} from "@sufria/shared";
import { cardView } from "../../features/orders/lib/board.ts";
import { detailView } from "../../features/orders/lib/details.ts";

const COMPONENTS = fileURLToPath(
  new URL("../../features/orders/components/", import.meta.url),
);
const read = (name: string): string =>
  readFileSync(`${COMPONENTS}${name}`, "utf8");

/** The declarations of one CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

const NOW = Date.parse("2026-10-19T10:00:00.000Z");

const ORDER: OrderListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 102,
  status: "accepted",
  fulfillmentType: "pickup",
  total: "13.50",
  itemCount: 3,
  createdAt: "2026-10-19T09:55:00.000Z",
  customer: { name: null, phone: "+962790004321" },
  items: [
    { name: "بطاطا", quantity: 1, note: null },
    { name: "شاورما", quantity: 2, note: "بدون بصل" },
    { name: "شاورما", quantity: 1, note: null },
  ],
  statusChangedAt: "2026-10-19T09:55:00.000Z",
  cancellationReason: null,
  unreadMessages: 0,
  lastMessage: null,
  staffMessagedAt: null,
};

test("a noted item leaves the grey line and gets a line of its own", () => {
  const view = cardView(ORDER, "active", "JOD", NOW);
  // The same item on two lines, one noted: the other stays grey.
  assert.equal(view.details, "استلام · بطاطا · شاورما");
  assert.deepEqual(view.notes, [
    { item: "شاورما ×", quantity: "2", label: "ملاحظة:", note: "بدون بصل" },
  ]);
});

test("every item noted → the grey line is the kind alone", () => {
  const view = cardView(
    {
      ...ORDER,
      items: [
        { name: "شاورما", quantity: 1, note: "بدون بصل" },
        { name: "بطاطا", quantity: 1, note: "مقرمشة" },
      ],
    },
    "active",
    "JOD",
    NOW,
  );
  assert.equal(view.details, "استلام");
  // ×1 too: the quantity always, in the items' order.
  assert.deepEqual(
    view.notes.map((n) => [n.item, n.quantity, n.note]),
    [
      ["شاورما ×", "1", "بدون بصل"],
      ["بطاطا ×", "1", "مقرمشة"],
    ],
  );
});

test("no note → the card as before", () => {
  const view = cardView(
    { ...ORDER, items: [{ name: "بطاطا", quantity: 1, note: null }] },
    "history",
    "JOD",
    NOW,
  );
  assert.equal(view.details, "استلام · بطاطا");
  assert.deepEqual(view.notes, []);
});

test("the label is shared's NOTE_LABEL_AR, and a note's $& stays as written", () => {
  const view = cardView(
    {
      ...ORDER,
      items: [{ name: "$& [الكمية]", quantity: 3, note: "$1 [الاسم]" }],
    },
    "active",
    "JOD",
    NOW,
  );
  assert.equal(view.notes[0]?.label, NOTE_LABEL_AR);
  assert.equal(view.notes[0]?.item, "$& [الكمية] ×");
  assert.equal(view.notes[0]?.note, "$1 [الاسم]");
});

test("the card: inside .who, under .details, before the message — the quantity .num, the note in a bdi", () => {
  const tsx = read("order-card.tsx");
  const details = tsx.indexOf("styles.details}>{view.details}");
  const notes = tsx.indexOf("view.notes.map");
  const message = tsx.indexOf("{view.message && (");
  assert.ok(details !== -1 && notes > details && message > notes);
  const block = tsx.slice(notes, message);
  assert.match(block, /<p key=\{i\} className=\{styles\.note\}>/);
  assert.match(block, /<span className="num">\{n\.quantity\}<\/span>/);
  assert.match(block, /className=\{styles\.noteLabel\}>\{n\.label\}/);
  assert.match(block, /<bdi dir="auto" className=\{styles\.noteText\}>/);
});

test("the card's CSS: 15px primary, wraps — never …; label 13/600 grey, note 600; 4px then 2px", () => {
  const css = read("order-card.module.css");
  const note = rule(css, ".note");
  assert.match(note, /font-size: 15px;/);
  assert.match(note, /color: var\(--text-primary\);/);
  assert.match(note, /margin-block-start: 2px;/);
  assert.match(rule(css, ".details + .note"), /margin-block-start: 4px;/);
  const label = rule(css, ".noteLabel");
  assert.match(label, /font-size: 13px;/);
  assert.match(label, /font-weight: 600;/);
  assert.match(label, /color: var\(--text-secondary\);/);
  const text = rule(css, ".noteText");
  assert.match(text, /font-weight: 600;/);
  assert.match(text, /color: var\(--text-primary\);/);
  for (const selector of [".note", ".noteLabel", ".noteText"]) {
    assert.doesNotMatch(rule(css, selector), /text-overflow|nowrap/, selector);
  }
});

const DETAIL: OrderDetail = {
  id: ORDER.id,
  orderNumber: 102,
  status: "accepted",
  fulfillmentType: "pickup",
  subtotal: "12.00",
  deliveryFee: "0.00",
  total: "12.00",
  paymentMethod: "cash",
  paymentStatus: "pending_cash",
  deliveryAddress: null,
  cancellationReason: null,
  createdAt: ORDER.createdAt,
  customer: ORDER.customer,
  items: [
    {
      name: "شاورما",
      quantity: 2,
      unitPrice: "5.00",
      lineTotal: "10.00",
      note: "بدون بصل",
    },
    {
      name: "بطاطا",
      quantity: 1,
      unitPrice: "2.00",
      lineTotal: "2.00",
      note: null,
    },
  ],
  history: [],
};

test("details.ts: each line carries its note, and the label is NOTE_LABEL_AR", () => {
  const view = detailView(DETAIL, "JOD", NOW);
  assert.deepEqual(view.lines, [
    { label: "شاورما ×2", amount: "10 د.أ", note: "بدون بصل" },
    { label: "بطاطا", amount: "2 د.أ", note: null },
  ]);
  assert.equal(view.noteLabel, NOTE_LABEL_AR);
  // Prices and the total do not move.
  assert.equal(view.total, "12 د.أ");
});

test("the details page: the note inside the line's li, across both columns, wrapping", () => {
  const tsx = read("order-details.tsx");
  const li = tsx.indexOf("<li key={i} className={styles.lineItem}>");
  const end = tsx.indexOf("</li>", li);
  const block = tsx.slice(li, end);
  assert.match(block, /l\.note !== null && \(/);
  assert.match(block, /<p className=\{styles\.lineNote\}>/);
  assert.match(block, /<bdi dir="auto" className=\{styles\.noteText\}>/);
  const css = read("order-details.module.css");
  const note = rule(css, ".lineNote");
  assert.match(note, /grid-column: 1 \/ -1;/);
  assert.match(note, /font-size: 15px;/);
  const label = rule(css, ".noteLabel");
  assert.match(label, /font-size: 13px;/);
  assert.match(label, /font-weight: 600;/);
  assert.match(label, /color: var\(--text-secondary\);/);
  assert.match(rule(css, ".noteText"), /font-weight: 600;/);
  for (const selector of [".lineNote", ".noteLabel", ".noteText"]) {
    assert.doesNotMatch(rule(css, selector), /text-overflow|nowrap/, selector);
  }
});
