/**
 * The menu screen's look after the laptop trial (brief ي-ب-9 §4, decision
 * 4A): the switched-off item, the phone's row, the pause box, the tools
 * row. Held by reading the TSX and the CSS, as the orders card's link is
 * (test/orders/card.test.mts): the look itself needs a browser, what
 * decides it does not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

type Rule = { media: string | null; selectors: string[]; body: string };

/** A CSS module's rules, top level and inside `@media`, comments aside. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const plain = (text: string, media: string | null) => {
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      out.push({
        media,
        selectors: m[1]!.split(",").map((s) => s.trim()),
        body: m[2]!.trim(),
      });
  };
  const MEDIA = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  for (const m of src.matchAll(MEDIA)) plain(m[2]!, m[1]!.trim());
  plain(src.replace(MEDIA, ""), null);
  return out;
}

/** The declarations for one selector, at one media query (none: top level). */
function body(css: string, selector: string, media: string | null = null) {
  const found = rules(css).filter(
    (r) => r.media === media && r.selectors.includes(selector),
  );
  assert.ok(found.length > 0, `no rule ${selector} ${media ?? ""}`);
  return found.map((r) => r.body).join("\n");
}

const WIDE = "(min-width: 640px)";
const C = "features/menu/components/";
const row = read(`${C}menu-row.tsx`);
const rowCss = read(`${C}menu-row.module.css`);
const screen = read(`${C}menu-screen.tsx`);
const removed = read(`${C}removed-items.tsx`);
const pauseBox = read(`${C}pause-box.tsx`);
const boxCss = read(`${C}pause-box.module.css`);
const icon = read(`${C}pause-icon.tsx`);
const iconCss = read(`${C}pause-icon.module.css`);

test("🔴 a switched-off item looks it: «مطفأ» inverted, «متاح» an outline; the row dashed, without its surface", () => {
  // The row says it is off; its word is the view's («متاح» or «مطفأ»).
  assert.match(row, /data-off=\{item\.isAvailable \? undefined : ""\}/);
  assert.match(row, /className=\{styles\.status\}>\{view\.status\}</);

  const off = body(rowCss, ".row[data-off]");
  assert.match(off, /background: transparent;/);
  assert.match(off, /border-style: dashed;/);
  assert.doesNotMatch(off, /border-color/, "the same colour: --border");
  for (const part of [".name", ".price"])
    assert.match(
      body(rowCss, `.row[data-off] ${part}`),
      /color: var\(--text-secondary\);/,
      part,
    );

  const available = body(rowCss, ".status");
  const inverted = body(rowCss, ".row[data-off] .status");
  assert.match(available, /border: 1px solid var\(--border\);/);
  assert.match(available, /color: var\(--text-secondary\);/);
  assert.doesNotMatch(available, /background/);
  assert.match(inverted, /background: var\(--text-primary\);/);
  assert.match(inverted, /border-color: var\(--text-primary\);/);
  assert.match(inverted, /color: var\(--bg\);/);

  // From 640 up, one width for the two words: the price's column stays.
  const wide = body(rowCss, ".status", WIDE);
  assert.match(wide, /min-width: 4\.25rem;/);
  assert.match(wide, /text-align: center;/);
});

test("🔴 the phone's row is two lines — name, its state, the price; then the buttons — and the DOM reads in that order", () => {
  const view = row.slice(row.indexOf("<div className={styles.view}>"));
  const at = (s: string) => {
    const i = view.indexOf(s);
    assert.notEqual(i, -1, s);
    return i;
  };
  // The reading order on the phone: name, state, price, buttons.
  assert.ok(at("styles.name") < at("styles.status"));
  assert.ok(at("styles.status") < at("styles.price"));
  assert.ok(at("styles.price") < at("styles.actions"));
  // The name and its state share one box; the price is outside it.
  const title = view.slice(at("styles.title"), at("styles.price"));
  assert.match(title, /styles\.name[\s\S]*styles\.status[\s\S]*<\/div>/);

  // Below 640: two rows, the price at the end of the first.
  const narrow = body(rowCss, ".view");
  assert.match(
    narrow,
    /grid-template-areas:\s*"title price"\s*"actions actions";/,
  );
  assert.match(narrow, /grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(body(rowCss, ".title"), /grid-area: title;/);
  assert.match(body(rowCss, ".row"), /padding: 10px 12px;/);
  // The three buttons in equal thirds, as before.
  assert.match(
    body(rowCss, ".actions"),
    /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );

  // From 640 up, the one row as before; the box steps aside.
  assert.match(
    body(rowCss, ".view", WIDE),
    /grid-template-areas: "name price status actions";/,
  );
  assert.match(body(rowCss, ".title", WIDE), /display: contents;/);
  assert.match(body(rowCss, ".row", WIDE), /padding: 12px 14px;/);
});

test("🔴 the pause bar is right under the header on the two menu pages — outside <main>, just before it — its sign before the words, gone while paused", () => {
  // Brief ل §4.1 (decision 1) replaced brief ي-ب-9 §4.3's box inside the
  // page, ~16px under the header's line: two lines close together.
  for (const [name, src] of [
    ["menu-screen.tsx", screen],
    ["removed-items.tsx", removed],
  ] as const)
    assert.match(src, /<>\s*<PauseBox \/>\s*<main className=/, name);
  // On those two pages alone: no other file renders it.
  const users = readdirSync(fileURLToPath(new URL("../../", import.meta.url)), {
    recursive: true,
    encoding: "utf8",
  }).filter(
    (f) =>
      /^(app|features|shared)\//.test(f) &&
      f.endsWith(".tsx") &&
      read(f).includes("<PauseBox"),
  );
  assert.deepEqual(users.sort(), [
    `${C}menu-screen.tsx`,
    `${C}removed-items.tsx`,
  ]);
  assert.match(pauseBox, /if \(ordersPausedAt !== null\) return null;/);
  // The button, then its line: the phone's reading order.
  assert.ok(
    pauseBox.indexOf("<button") < pauseBox.indexOf("{M.pauseHintLead}"),
  );

  // The sign: CSS alone, two bars, hidden from screen readers.
  assert.match(pauseBox, /<PauseIcon \/>\s*\{M\.pause\}/);
  assert.match(icon, /<span className=\{styles\.icon\} aria-hidden="true" \/>/);
  assert.doesNotMatch(icon, /<svg/);
  const bars = body(iconCss, ".icon");
  assert.match(bars, /width: 10px;/);
  assert.match(bars, /height: 12px;/);
  assert.match(bars, /border-inline: 3px solid currentColor;/);

  // The bar: the screen's width, the surface, a line under it — no sides,
  // no corners — its content the page's width and edges.
  assert.match(
    pauseBox,
    /<div className=\{styles\.bar\}>\s*<div className=\{styles\.box\}>/,
  );
  const bar = body(boxCss, ".bar");
  assert.match(bar, /background: var\(--surface\);/);
  assert.match(bar, /border-block-end: 1px solid var\(--border\);/);
  assert.match(bar, /padding-block: 10px;/);
  assert.doesNotMatch(bar, /border(-inline)?:|radius|padding-inline|max-width/);
  const box = body(boxCss, ".box");
  assert.match(box, /max-width: var\(--page-width, none\);/);
  assert.match(box, /margin-inline: auto;/);
  assert.match(box, /padding-inline: 18px;/);
  assert.doesNotMatch(box, /background|border|radius/);
  // Below 640 the button over its line; from 640 side by side, centred.
  assert.match(box, /grid-template-areas:\s*"button"\s*"hint";/);
  assert.match(box, /justify-items: start;/);
  assert.match(box, /gap: 8px 12px;/);
  const wide = body(boxCss, ".box", WIDE);
  assert.match(wide, /grid-template-areas: "button hint";/);
  assert.match(wide, /align-items: center;/);

  // The button: the screen's secondary, on the page's ground.
  assert.match(
    pauseBox,
    /className=\{`\$\{screen\.secondary\} \$\{styles\.button\}`\}/,
  );
  assert.match(body(boxCss, ".box .button"), /background: var\(--bg\);/);

  // The hint in two pieces: the customer's message whole, inline-block.
  assert.match(
    pauseBox,
    /<p className=\{styles\.hint\}>\s*\{M\.pauseHintLead\} <span>\{M\.pauseHintQuote\}<\/span>\s*<\/p>/,
  );
  assert.match(body(boxCss, ".hint > span"), /display: inline-block;/);
});

test("🔴 «الأصناف»'s tools are one row at every width: «أضف صنفا» at the start, «المطفأة» and «شغّل الكل» at the end while any is off", () => {
  const css = read(`${C}menu-screen.module.css`);
  const tools = body(css, ".tools");
  assert.match(tools, /grid-template-areas: "add \. off";/);
  assert.match(tools, /grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  // One row at every width: no rule for it under any media query.
  assert.ok(!rules(css).some((r) => r.media && r.selectors.includes(".tools")));
  assert.match(body(css, ".add"), /grid-area: add;/);
  assert.match(body(css, ".off"), /grid-area: off;/);

  // On «الأصناف» alone; «أضف صنفا» first, the count and its button after,
  // and only while the count is over 0.
  assert.doesNotMatch(removed, /styles\.tools/);
  const at = screen.indexOf("className={styles.tools}");
  assert.notEqual(at, -1);
  const row = screen.slice(at, screen.indexOf("{ready && adding", at));
  assert.ok(row.indexOf("{M.add}") < row.indexOf("offCountAr(off)"));
  assert.match(row, /\{off > 0 && \(\s*<div className=\{styles\.off\}>/);
  assert.ok(row.indexOf("offCountAr(off)") < row.indexOf("{M.enableAll}"));
});
