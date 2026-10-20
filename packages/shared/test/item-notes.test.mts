/**
 * Item notes in the parser — brief ن §2 (ن-1). One test per row of the
 * brief's tables, by its message; the menu holds 1–12 and 99 is not on it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_COMMAND_INPUT_LISTS,
  REPLY_WORD_INPUTS,
  cleanNote,
  isReplyWord,
  joinNotes,
  normalizeArabic,
  normalizeWithOrigins,
  noteKey,
  noteLength,
  noteWithoutName,
  parseItems,
  type MenuMap,
} from "@sufria/shared";

const MENU: MenuMap = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return [String(i + 1), `000000${n}-0000-4000-8000-0000000000${n}`];
  }),
);

/** `[number, qty, note]` per line, in the order the message met them. */
type Row = [number, number, string | null];

function rows(raw: string): Row[] {
  return parseItems(raw, MENU).items.map((i) => [i.number, i.qty, i.note]);
}

// ---------------------------------------------------------------------------
// §2.2 — the table, row by row
// ---------------------------------------------------------------------------

const TABLE: readonly {
  raw: string;
  rows: Row[];
  unclear?: string[];
  unknown?: number[];
}[] = [
  { raw: "2 بدون بصل", rows: [[2, 1, "بدون بصل"]] },
  {
    raw: "2 بدون بصل 5",
    rows: [
      [2, 1, "بدون بصل"],
      [5, 1, null],
    ],
  },
  { raw: "2 ×2 بدون بصل", rows: [[2, 2, "بدون بصل"]] },
  { raw: "2 بدون بصل ×2", rows: [[2, 2, "بدون بصل"]] },
  {
    raw: "2 بدون بصل، زيادة صوص 3",
    rows: [
      [2, 1, "بدون بصل، زيادة صوص"],
      [3, 1, null],
    ],
  },
  { raw: "2 بدون بصل و زيادة صوص", rows: [[2, 1, "بدون بصل و زيادة صوص"]] },
  {
    raw: "2 بدون بصل و 3",
    rows: [
      [2, 1, "بدون بصل"],
      [3, 1, null],
    ],
  },
  { raw: "2 زيادة بطاطا", rows: [[2, 1, "زيادة بطاطا"]] },
  {
    raw: "2 بدون بصل 2",
    rows: [
      [2, 1, "بدون بصل"],
      [2, 1, null],
    ],
  },
  { raw: "2 بدون بصل 2 بدون بصل", rows: [[2, 2, "بدون بصل"]] },
  { raw: "بدون بصل 2", rows: [[2, 1, null]], unclear: ["بدون بصل"] },
  { raw: "99 بدون بصل 3", rows: [[3, 1, null]], unknown: [99] },
  { raw: "٢ بدون بصل", rows: [[2, 1, "بدون بصل"]] },
  { raw: "2 بدون بصل تم", rows: [[2, 1, "بدون بصل"]] },
  {
    raw: "2\nبدون بصل\n3",
    rows: [
      [2, 1, "بدون بصل"],
      [3, 1, null],
    ],
  },
  // An accepted limit: a number inside a note starts an item.
  {
    raw: "2 مع 2 خبز",
    rows: [
      [2, 1, "مع"],
      [2, 1, "خبز"],
    ],
  },
];

for (const row of TABLE) {
  test(`§2.2 «${row.raw.replace(/\n/g, "⏎")}»`, () => {
    const result = parseItems(row.raw, MENU);
    assert.deepEqual(rows(row.raw), row.rows);
    assert.deepEqual(result.problems.unclearParts, row.unclear ?? []);
    assert.deepEqual(result.problems.unknownNumbers, row.unknown ?? []);
  });
}

test("§2.2 «2 زيادة بطاطا»: the raw text, not «زياده»", () => {
  assert.equal(parseItems("2 زيادة بطاطا", MENU).items[0]?.note, "زيادة بطاطا");
  assert.equal(parseItems("2 أكثر جبنة", MENU).items[0]?.note, "أكثر جبنة");
});

test("§2.2 «2 بدون بصل تم»: the order does not finish — the parser has it", () => {
  // `interpretMessage` matches the whole message alone: this is items.
  const result = parseItems("2 بدون بصل تم", MENU);
  assert.equal(result.outcome, "parsed");
  // Every finish word at the end goes, multi-word ones included.
  assert.equal(
    parseItems("2 بدون بصل هاد كل شي", MENU).items[0]?.note,
    "بدون بصل",
  );
  assert.equal(parseItems("2 تم", MENU).items[0]?.note, null);
});

test("notes are compared normalized; the first raw text is the one kept", () => {
  assert.deepEqual(rows("2 زيادة صوص 2 زياده صوص"), [[2, 2, "زيادة صوص"]]);
  assert.deepEqual(rows("2 زياده صوص 2 زيادة صوص"), [[2, 2, "زياده صوص"]]);
});

test("separators at a note's two ends go; inside it, they stay", () => {
  assert.deepEqual(rows("2، بدون بصل، 3"), [
    [2, 1, "بدون بصل"],
    [3, 1, null],
  ]);
  assert.deepEqual(rows("2 + بدون بصل + 3"), [
    [2, 1, "بدون بصل"],
    [3, 1, null],
  ]);
  assert.deepEqual(rows("2 بدون بصل وزيادة صوص"), [
    [2, 1, "بدون بصل وزيادة صوص"],
  ]);
});

test("white space inside a note is one space", () => {
  assert.deepEqual(rows("2   بدون\n\nبصل"), [[2, 1, "بدون بصل"]]);
});

test("a quantity between two runs of a note is the line's, not the note's", () => {
  assert.deepEqual(rows("2 بدون بصل ×3 زيادة صوص"), [
    [2, 3, "بدون بصل زيادة صوص"],
  ]);
  assert.deepEqual(rows("2 بدون بصل × 3"), [[2, 3, "بدون بصل"]]);
});

test("the cap is on the whole item, however its lines are noted", () => {
  const result = parseItems("2 ×30 بدون بصل 2 ×30", MENU);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.problems.overCapItems, [
    { number: 2, requestedQty: 60 },
  ]);
  assert.deepEqual(rows("2 ×25 بدون بصل 2 ×25"), [
    [2, 25, "بدون بصل"],
    [2, 25, null],
  ]);
});

test("a note after a number off the menu goes with it", () => {
  const result = parseItems("99 بدون بصل", MENU);
  assert.equal(result.outcome, "unparsed");
  assert.deepEqual(result.problems.unclearParts, []);
  assert.deepEqual(result.problems.unknownNumbers, [99]);
});

test("a note is the customer's text, invisible characters gone", () => {
  assert.deepEqual(rows("2 بدون‏ بصل​"), [[2, 1, "بدون بصل"]]);
});

// ---------------------------------------------------------------------------
// §2.5 — cleaning, the key, the length
// ---------------------------------------------------------------------------

test("cleanNote: controls and direction marks out, spaces one, empty null", () => {
  assert.equal(cleanNote("  بدون\t\tبصل \n"), "بدون بصل");
  assert.equal(cleanNote("‫بدون‬ ⁦بصل⁩﻿\u0007"), "بدون بصل");
  assert.equal(cleanNote("‎‏ \n"), null);
  assert.equal(cleanNote(""), null);
  // The words as written: no normalization.
  assert.equal(cleanNote("زيادة جبنة!"), "زيادة جبنة!");
});

test("noteKey: «زيادة» and «زياده» are one note; none is null", () => {
  assert.equal(noteKey("زيادة"), noteKey("زياده"));
  assert.notEqual(noteKey("بدون بصل"), noteKey("بدون ثوم"));
  assert.equal(noteKey(null), null);
});

test("noteLength counts code points, as char_length does", () => {
  assert.equal(noteLength("بدون بصل"), 8);
  assert.equal(noteLength("👍👍"), 2);
});

test("joinNotes: an Arabic comma and a space", () => {
  assert.equal(joinNotes("بدون بصل", "زيادة صوص"), "بدون بصل، زيادة صوص");
});

// ---------------------------------------------------------------------------
// §2.3 — the item's name is not a note
// ---------------------------------------------------------------------------

for (const [name, note, expected] of [
  ["شاورما دجاج", "شاورما", null],
  ["شاورما دجاج", "شاورما دجاج بدون بصل", "بدون بصل"],
  ["شاورما دجاج", "شاورما لحمة", "لحمة"],
  ["شاورما دجاج", "دجاج", "دجاج"],
  ["قهوة بدون سكر", "قهوة بدون هيل", "بدون هيل"],
  ["قهوة بدون سكر", "بدون هيل", "بدون هيل"],
  ["فلافل مع حمص", "فلافل مع ثومية", "ثومية"],
  ["فلافل", "فلافل", null],
  ["حمص", "حمص", null],
] as const) {
  test(`§2.3 «${name}» · «${note}» → ${expected ?? "—"}`, () => {
    assert.equal(noteWithoutName(note, name), expected);
  });
}

test("§2.3 «1 فلافل 2 حمص» (2 = حمص): neither line keeps a note", () => {
  const items = parseItems("1 فلافل 2 حمص", MENU).items;
  assert.deepEqual(
    items.map((i) =>
      i.note === null
        ? null
        : noteWithoutName(i.note, i.number === 1 ? "فلافل" : "حمص"),
    ),
    [null, null],
  );
});

test("§2.3 the name normalized: «قهوه» takes «قهوة» off", () => {
  assert.equal(noteWithoutName("قهوه بدون هيل", "قهوة بدون سكر"), "بدون هيل");
});

test("§2.3 a separator the name leaves at the start goes", () => {
  assert.equal(noteWithoutName("شاورما، بدون بصل", "شاورما دجاج"), "بدون بصل");
  assert.equal(noteWithoutName("شاورما و بدون بصل", "شاورما دجاج"), "بدون بصل");
});

test("§2.3 every negation word stays, wherever the name has it", () => {
  for (const word of ["بدون", "بلا", "بلاش", "غير", "من"]) {
    assert.equal(
      noteWithoutName(`${word} سكر`, `${word} سكر`),
      `${word} سكر`,
      word,
    );
  }
});

// ---------------------------------------------------------------------------
// §2.4 — words of reply
// ---------------------------------------------------------------------------

test("§2.4 every word of reply is stored normalized", () => {
  for (const entry of REPLY_WORD_INPUTS) {
    assert.equal(normalizeArabic(entry), entry, entry);
  }
});

test("§2.4 the list, as the brief writes it", () => {
  for (const raw of [
    "تمام",
    "تمام تمام",
    "شكرا",
    "مشكور",
    "يسلمو",
    "اوكي",
    "اوك",
    "ok",
    "طيب",
    "ماشي",
    "حلو",
    "اه",
    "اي",
    "ايوه",
    "نعم",
    "لا",
    "مرحبا",
    "هلا",
    "السلام عليكم",
    "يعطيك العافيه",
  ]) {
    assert.ok(isReplyWord(raw), raw);
  }
  assert.equal(REPLY_WORD_INPUTS.length, 20);
});

test("§2.4 the whole message, normalized, Latin without case", () => {
  assert.ok(isReplyWord("يعطيك العافية"));
  assert.ok(isReplyWord("آه"));
  assert.ok(isReplyWord("OK"));
  assert.ok(isReplyWord("Ok 👍"));
  assert.ok(isReplyWord("شكرًا!"));
  assert.equal(isReplyWord("تمام بدون بصل"), false);
  assert.equal(isReplyWord("بدون بصل"), false);
  assert.equal(isReplyWord("👍"), false);
});

test("§2.4 no word of reply is a command", () => {
  const commands = new Set(ALL_COMMAND_INPUT_LISTS.flatMap(([, e]) => e));
  for (const entry of REPLY_WORD_INPUTS) {
    assert.equal(commands.has(entry), false, entry);
  }
});

// ---------------------------------------------------------------------------
// The one normalization, with where each character came from
// ---------------------------------------------------------------------------

test("normalizeWithOrigins: its text is normalizeArabic's, each span the raw", () => {
  const raw = " «أَهلاً  بالجمـيع» ٢×٣ 👍 ";
  const chars = normalizeWithOrigins(raw);
  assert.equal(chars.map((c) => c.c).join(""), normalizeArabic(raw));
  assert.equal(raw.slice(chars[0]!.start, chars[0]!.end), "أ");
  // A diacritic and a tatweel are dropped; their letters keep their own span.
  const run = chars.find((c) => c.c === " ")!;
  assert.equal(raw.slice(run.start, run.end), "  ");
  const four = chars.find((c) => c.c === "2")!;
  assert.equal(raw.slice(four.start, four.end), "٢");
});
