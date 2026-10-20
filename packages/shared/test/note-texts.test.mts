/**
 * The note's texts — brief ن §3 (ن1–ن5), letter for letter, and where they
 * show: «أضفت» (ن2), «سلة», the summary, «آخر طلب لك», ن3, ن4أ.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_CUSTOMER_TEXTS_AR,
  NOTE_ADDED_HEADER_AR,
  NOTE_HINT_AR,
  NOTE_LABEL_AR,
  NOTE_LINE_AR,
  NOTE_MAX_LENGTH,
  NOTE_TOO_LONG_AR,
  NOTE_TOO_LONG_ITEM_AR,
  buildOrderSummary,
  cartMessageAr,
  itemsAddedLinesAr,
  noteAddedAr,
  noteLineAr,
  noteTooLongItemAr,
  reorderBlockAr,
} from "@sufria/shared";

test("ن1–ن5 letter for letter (§3)", () => {
  assert.equal(NOTE_LABEL_AR, "ملاحظة:");
  assert.equal(NOTE_LINE_AR, "ملاحظة: [الملاحظة]");
  assert.equal(NOTE_ADDED_HEADER_AR, "أضفت الملاحظة:");
  assert.equal(
    NOTE_TOO_LONG_ITEM_AR,
    "الصنف [الاسم] لم يُضف: ملاحظته أطول من 100 حرف. اكتب رقمه وملاحظة أقصر.",
  );
  assert.equal(NOTE_TOO_LONG_AR, "الملاحظة أطول من 100 حرف. اكتبها أقصر.");
  assert.equal(NOTE_HINT_AR, "للملاحظة، اكتبها بعد رقم الصنف في نفس الرسالة.");
});

test("the 100 written in ن4أ and ن4ب is NOTE_MAX_LENGTH", () => {
  assert.equal(NOTE_MAX_LENGTH, 100);
  for (const text of [NOTE_TOO_LONG_ITEM_AR, NOTE_TOO_LONG_AR]) {
    assert.ok(text.includes(`أطول من ${NOTE_MAX_LENGTH} حرف`), text);
  }
});

test("the new templates are among the customer's texts — every guard sees them", () => {
  for (const text of [
    NOTE_LINE_AR,
    NOTE_ADDED_HEADER_AR,
    NOTE_TOO_LONG_ITEM_AR,
    NOTE_TOO_LONG_AR,
    NOTE_HINT_AR,
  ]) {
    assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(text), text);
  }
});

test("ن1: the note as written — a slot or $& in it stays literal", () => {
  assert.equal(noteLineAr("بدون بصل"), "ملاحظة: بدون بصل");
  assert.equal(noteLineAr("$& [الاسم]"), "ملاحظة: $& [الاسم]");
});

test("ن2: one line with a note → the multiple form, ن1 under it", () => {
  assert.deepEqual(
    itemsAddedLinesAr(
      [{ name: "شاورما دجاج", qty: 1, note: "بدون بصل" }],
      350,
      "JOD",
    ),
    ["أضفت:", "شاورما دجاج ×1", "ملاحظة: بدون بصل", "المجموع 3.50 د.أ"],
  );
});

test("ن2: ن1 under each line that has one, the others as they were", () => {
  assert.deepEqual(
    itemsAddedLinesAr(
      [
        { name: "شاورما دجاج", qty: 2, note: "بدون بصل" },
        { name: "حمص", qty: 1, note: null },
        { name: "فلافل", qty: 3, note: "حار" },
      ],
      1450,
      "JOD",
    ),
    [
      "أضفت:",
      "شاورما دجاج ×2",
      "ملاحظة: بدون بصل",
      "حمص ×1",
      "فلافل ×3",
      "ملاحظة: حار",
      "المجموع 14.50 د.أ",
    ],
  );
});

test("ن2: no note → «أضفت» exactly as before", () => {
  assert.deepEqual(
    itemsAddedLinesAr([{ name: "حمص", qty: 1, note: null }], 250, "JOD"),
    ["أضفت: حمص ×1 — المجموع 2.50 د.أ"],
  );
});

test("ن3: the pieces it went to, and the note whole", () => {
  assert.equal(
    noteAddedAr("شاورما دجاج", 2, "بدون بصل، زيادة صوص"),
    "أضفت الملاحظة:\nشاورما دجاج ×2\nملاحظة: بدون بصل، زيادة صوص",
  );
});

test("ن4أ: the item named after «الصنف»", () => {
  assert.equal(
    noteTooLongItemAr("شاورما دجاج"),
    "الصنف شاورما دجاج لم يُضف: ملاحظته أطول من 100 حرف. اكتب رقمه وملاحظة أقصر.",
  );
});

const LINES = [
  {
    menuNumber: 2,
    name: "شاورما دجاج",
    qty: 1,
    lineTotalMinor: 350,
    note: "بدون بصل",
  },
  {
    menuNumber: 2,
    name: "شاورما دجاج",
    qty: 1,
    lineTotalMinor: 350,
    note: null,
  },
  { menuNumber: 5, name: "حمص", qty: 2, lineTotalMinor: 500 },
] as const;

test("«سلة»: ن1 under each line with a note; «شيل» at the end as before", () => {
  assert.equal(
    cartMessageAr(LINES, 1200, "JOD"),
    [
      "سلّتك:",
      "2 · شاورما دجاج ×1 — 3.50 د.أ",
      "ملاحظة: بدون بصل",
      "2 · شاورما دجاج ×1 — 3.50 د.أ",
      "5 · حمص ×2 — 5 د.أ",
      "المجموع 12 د.أ",
      "لحذف صنف: «شيل» ورقمه",
    ].join("\n"),
  );
});

test("the summary: ن1 under each line with a note, nothing else changed", () => {
  assert.equal(
    buildOrderSummary(LINES, 1200, { type: "pickup" }, "JOD"),
    [
      "ملخّص طلبك:",
      "2 · شاورما دجاج ×1 — 3.50 د.أ",
      "ملاحظة: بدون بصل",
      "2 · شاورما دجاج ×1 — 3.50 د.أ",
      "5 · حمص ×2 — 5 د.أ",
      "المجموع 12 د.أ",
      "الاستلام من المطعم",
      "الدفع نقدا.",
      "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    ].join("\n"),
  );
});

test("«آخر طلب لك»: ن1 under the line", () => {
  assert.equal(
    reorderBlockAr(
      [
        { name: "شاورما دجاج", qty: 2, lineTotalMinor: 700, note: "بدون بصل" },
        { name: "حمص", qty: 1, lineTotalMinor: 250, note: null },
      ],
      [],
      "JOD",
    ),
    [
      "آخر طلب لك:",
      "شاورما دجاج ×2 — 7 د.أ",
      "ملاحظة: بدون بصل",
      "حمص ×1 — 2.50 د.أ",
      "المجموع 9.50 د.أ",
      "اكتب «نفسه» لتكرار الطلب.",
    ].join("\n"),
  );
});
