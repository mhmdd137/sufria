/**
 * The header on a wide screen (brief I-9 #9): its content takes the page's
 * width and edges — 880px for «الطلبات» and «السجل», 1200px for an order —
 * while its background and line stay the screen's. Measured on the lab at
 * 1920px: the logo sat ~500px from the list's edge. Each page puts its width
 * on the body (`--page-width`, by `:has`), the header reads it: shared/ never
 * imports a feature (§2.2, 3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

/** The declarations of one top-level CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

const header = read("shared/layout/dashboard-header.module.css");

test("the header's background is the screen's: no side padding on it", () => {
  const top = rule(header, ".top");
  assert.match(top, /background: var\(--surface\);/);
  assert.match(top, /border-block-end: 1px solid var\(--border\);/);
  assert.doesNotMatch(top, /padding(-inline)?:|max-width/);
});

test("the header's content: the page's width and its 18px edges", () => {
  const bounds = rule(header, ".bounds");
  assert.match(bounds, /max-width: var\(--page-width, none\);/);
  assert.match(bounds, /margin-inline: auto;/);
  assert.match(bounds, /padding-inline: 18px;/);
  const tsx = read("shared/layout/dashboard-header.tsx");
  // Everything the header shows sits in it — the logo first, the tabs last.
  const inner = tsx.indexOf("styles.bounds");
  assert.ok(inner !== -1 && inner < tsx.indexOf("<BrandMark"));
  assert.ok(tsx.indexOf("</nav>") < tsx.indexOf("</header>"));
  // The offline strip, part of the header, lines up with it too.
  const strip = tsx.slice(tsx.indexOf("styles.offline"));
  assert.match(strip, /styles\.bounds\}>\{T\.errors\.disconnected\}/);
});

for (const [page, file, selector, width] of [
  [
    "«الطلبات» and «السجل»",
    "features/orders/components/order-list.module.css",
    ".list",
    "880px",
  ],
  [
    "an order",
    "features/orders/components/order-details.module.css",
    ".page",
    "1200px",
  ],
] as const)
  test(`${page}: puts its width on the body and keeps to it, 18px from its edges`, () => {
    const css = read(file);
    assert.match(
      rule(css, `:global(body):has(${selector})`),
      new RegExp(`--page-width: ${width};`),
    );
    const main = rule(css, selector);
    assert.match(main, /max-width: var\(--page-width\);/);
    assert.match(main, /margin-inline: auto;/);
    assert.match(main, /padding: 14px 18px/);
  });

test("🔴 the compact header: the mark, the restaurant's name, «مباشر» and logout on the first line; the tabs on the second — «سُفريا» gone from it", () => {
  // Brief ل §5.1 (addition 2, Mohammed's decision of 12 October): 161px
  // on a phone became 117. «سُفريا» stays on the login page and the tab.
  const tsx = read("shared/layout/dashboard-header.tsx");
  const top = tsx.slice(
    tsx.indexOf("className={styles.topRow}"),
    tsx.indexOf("<nav"),
  );
  const at = (s: string) => {
    const i = top.indexOf(s);
    assert.notEqual(i, -1, s);
    return i;
  };
  assert.ok(at("<BrandMark />") < at("{restaurantName}"));
  assert.ok(at("{restaurantName}") < at("{T.live}"));
  assert.ok(at("{T.live}") < at("{T.logout}"));
  assert.match(
    top,
    /<span className=\{styles\.title\}>\{restaurantName\}<\/span>/,
  );
  assert.doesNotMatch(tsx, /T\.brand/);
  assert.equal((tsx.match(/\{restaurantName\}/g) ?? []).length, 1);
  assert.doesNotMatch(
    tsx.replace(/\/\*[\s\S]*?\*\//g, ""),
    /<h1|<p\b/,
    "the name is not the page's <h1>",
  );
  // «سُفريا» where it stays.
  assert.match(read("features/auth/components/login-form.tsx"), /\{T\.brand\}/);
  assert.match(read("app/layout.tsx"), /title: DASHBOARD_UI_AR\.brand/);

  const name = rule(header, ".title");
  for (const decl of [
    "min-width: 0;",
    "font-size: 19px;",
    "font-weight: 700;",
    "overflow: hidden;",
    "text-overflow: ellipsis;",
    "white-space: nowrap;",
  ])
    assert.ok(name.includes(decl), `.title: ${decl}`);
  assert.doesNotMatch(header, /\.wordmark|26px/);
});
