/**
 * Under the pointer and pressed, on every page (brief ل §3, decision 2):
 * a light fill under the pointer, a stronger one pressed, from the eight
 * `*-hover` and `*-press` tokens. Held by reading every CSS file of the
 * app: the look needs a browser, the rules that decide it do not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const HOVER_MEDIA = "@media (hover: hover) and (pointer: fine)";
/** Neither a disabled button nor a working one changes (brief ل §3). */
const GUARD = ':not(:disabled, [aria-busy="true"])';

type Rule = { file: string; at: string[]; selector: string; body: string };

/** Splits at the commas outside parentheses: `:not(a, b)` stays whole. */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let part = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(part.trim());
      part = "";
    } else part += ch;
  }
  out.push(part.trim());
  return out;
}

/** Every rule of a stylesheet, one per selector, with its enclosing at-rules. */
function rules(file: string): Rule[] {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (ch === "}") {
      const head = stack.pop()!;
      if (!head.startsWith("@"))
        for (const selector of splitTop(head))
          out.push({
            file,
            at: stack.filter((h) => h.startsWith("@")),
            selector,
            body: buf.trim(),
          });
      buf = "";
    } else buf += ch;
  }
  return out;
}

function cssFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".css"))
    .map((f) => join(dir, f));
}

const FILES = ["app", "features", "shared"].flatMap(cssFiles);
const ALL = FILES.flatMap(rules);

/** A state's selector without its guard and its pseudo-class. */
const base = (selector: string, state: ":hover" | ":active") =>
  selector.replace(GUARD, "").replace(state, "");

test("the scan sees the dashboard's stylesheets", () => {
  assert.ok(FILES.length >= 15, FILES.join("\n"));
  assert.ok(ALL.some((r) => r.selector.includes(":hover")));
});

test("🔴 every :hover is inside @media (hover: hover) and (pointer: fine) — a phone never keeps it after a tap", () => {
  const outside = ALL.filter(
    (r) => r.selector.includes(":hover") && !r.at.includes(HOVER_MEDIA),
  ).map((r) => `${r.file}: ${r.selector}`);
  assert.deepEqual(outside, []);
});

test("🔴 every rule with cursor: pointer has its :active, on every device", () => {
  const pointers = ALL.filter((r) => /cursor: pointer;/.test(r.body));
  assert.ok(pointers.length >= 15, `${pointers.length}`);
  const missing = pointers
    .filter(
      (p) =>
        !ALL.some(
          (r) =>
            r.file === p.file &&
            r.selector.includes(":active") &&
            base(r.selector, ":active") === p.selector &&
            !r.at.includes(HOVER_MEDIA),
        ),
    )
    .map((p) => `${p.file}: ${p.selector}`);
  assert.deepEqual(missing, []);
});

test("🔴 a disabled or working button does not change: every state of a pointer rule carries the guard", () => {
  // The method (brief ل §3, «بالطريقة اللي بتختارها»): the hover and the
  // press of every control with `cursor: pointer` are written
  // `:not(:disabled, [aria-busy="true"])`, so neither ever matches it.
  const pointers = ALL.filter((r) => /cursor: pointer;/.test(r.body));
  const unguarded: string[] = [];
  for (const p of pointers)
    for (const state of [":hover", ":active"] as const)
      for (const r of ALL)
        if (
          r.file === p.file &&
          r.selector.includes(state) &&
          base(r.selector, state) === p.selector &&
          !r.selector.includes(GUARD)
        )
          unguarded.push(`${r.file}: ${r.selector}`);
  assert.deepEqual(unguarded, []);
});

/**
 * The brief's table (§3): each kind's hover and press. `line`: the control
 * has a border, and it takes the fill's colour in both states.
 */
const KINDS: {
  kind: string;
  file: string;
  selector: string;
  hover: string;
  press: string;
  line: boolean;
}[] = [
  ...(
    [
      ["features/menu/components/menu-screen.module.css", ".primary", false],
      ["features/menu/components/add-item-form.module.css", ".primary", false],
      ["features/orders/components/order-card.module.css", ".action", false],
      ["features/orders/components/order-details.module.css", ".step", false],
      ["features/auth/components/login-form.module.css", ".submit", false],
    ] as const
  ).map(([file, selector, line]) => ({
    kind: "primary",
    file,
    selector,
    hover: "accent-hover",
    press: "accent-press",
    line,
  })),
  ...(
    [
      ["features/menu/components/menu-screen.module.css", ".secondary", true],
      ["features/menu/components/menu-row.module.css", ".button", true],
      ["features/menu/components/add-item-form.module.css", ".button", true],
      ["features/menu/components/confirm-dialog.module.css", ".button", true],
      ["features/menu/components/removed-items.module.css", ".button", true],
      [
        "features/menu/components/orders-paused-strip.module.css",
        ".resume",
        true,
      ],
      [
        "features/orders/components/order-details.module.css",
        ".secondary",
        true,
      ],
      ["features/orders/components/cancel-dialog.module.css", ".button", true],
      ["features/orders/components/conversation.module.css", ".retry", true],
      ["features/orders/components/order-list.module.css", ".more", true],
      ["shared/layout/dashboard-header.module.css", ".logout", true],
      ["features/orders/components/conversation.module.css", ".more", false],
    ] as const
  ).map(([file, selector, line]) => ({
    kind: "on surface",
    file,
    selector,
    hover: "surface-hover",
    press: "surface-press",
    line,
  })),
  {
    kind: "on bg",
    file: "features/menu/components/pause-box.module.css",
    selector: ".box .button",
    hover: "bg-hover",
    press: "bg-press",
    line: true,
  },
];

for (const k of KINDS)
  test(`${k.kind}: ${k.file.split("/").pop()} ${k.selector} — ${k.hover} under the pointer, ${k.press} pressed`, () => {
    const state = (s: ":hover" | ":active") => {
      const found = ALL.filter(
        (r) =>
          r.file === k.file &&
          r.selector.includes(s) &&
          base(r.selector, s) === k.selector,
      );
      assert.equal(found.length, 1, `${k.selector}${s}`);
      assert.ok(found[0]!.selector.includes(GUARD), found[0]!.selector);
      return found[0]!.body;
    };
    for (const [s, token] of [
      [":hover", k.hover],
      [":active", k.press],
    ] as const) {
      const body = state(s);
      assert.match(body, new RegExp(`background: var\\(--${token}\\);`));
      if (k.line)
        assert.match(body, new RegExp(`border-color: var\\(--${token}\\);`));
    }
  });

test("the header's tabs: under the pointer the text primary and a 2px muted line; pressed, the pressed surface — the page's own tab never", () => {
  const css = "shared/layout/dashboard-header.module.css";
  const of = (s: string) =>
    ALL.filter((r) => r.file === css && r.selector === s);
  const [hover] = of(`.tab:not([aria-current="page"]):hover`);
  const [press] = of(`.tab:not([aria-current="page"]):active`);
  assert.ok(hover && press);
  assert.match(hover.body, /color: var\(--text-primary\);/);
  assert.match(hover.body, /border-block-end-color: var\(--text-muted\);/);
  assert.match(press.body, /background: var\(--surface-press\);/);
  assert.ok(
    !ALL.some(
      (r) =>
        r.file === css &&
        /\.tab\[aria-current="page"\]:(hover|active)/.test(r.selector),
    ),
  );
});

test("the order card: the card under the pointer unless its button is; pressed through its link (.card:active never fires for a press inside it)", () => {
  const css = "features/orders/components/order-card.module.css";
  const of = (s: string) => ALL.find((r) => r.file === css && r.selector === s);
  const hover = of(".card:hover:not(:has(.action:hover))");
  const press = of(".card:has(.open:active)");
  assert.ok(hover && press);
  assert.ok(hover.at.includes(HOVER_MEDIA));
  assert.match(hover.body, /background: var\(--surface-hover\);/);
  assert.match(press.body, /background: var\(--surface-press\);/);
  assert.ok(!ALL.some((r) => r.file === css && r.selector === ".card:active"));
});

test("the back link: its text primary under the pointer and pressed", () => {
  const css = "features/orders/components/order-details.module.css";
  for (const s of [".back:hover", ".back:active"]) {
    const r = ALL.find((x) => x.file === css && x.selector === s);
    assert.ok(r, s);
    assert.match(r.body, /color: var\(--text-primary\);/);
  }
});

test("every field: its line --text-muted under the pointer", () => {
  for (const css of [
    "features/menu/components/menu-row.module.css",
    "features/menu/components/add-item-form.module.css",
    "features/orders/components/cancel-dialog.module.css",
    "features/auth/components/login-form.module.css",
  ]) {
    const r = ALL.find((x) => x.file === css && x.selector === ".input:hover");
    assert.ok(r, css);
    assert.match(r.body, /border-color: var\(--text-muted\);/);
  }
});

test("🔴 the timing: 120ms ease-out, the press at once, none under reduced motion; no browser flash on a tap", () => {
  const globals = ALL.filter((r) => r.file === "app/globals.css");
  assert.ok(
    globals.some(
      (r) =>
        r.selector === "html" &&
        r.at.length === 0 &&
        /-webkit-tap-highlight-color: transparent;/.test(r.body),
    ),
  );

  const MOTION = "@media (prefers-reduced-motion: no-preference)";
  const moving = globals.filter((r) => r.at.includes(MOTION));
  for (const el of ["a", "button", "input", "select", "textarea"]) {
    const r = moving.find((x) => x.selector === el);
    assert.ok(r, el);
    for (const prop of ["background-color", "border-color", "color"])
      assert.match(r.body, new RegExp(`(^|\\s)${prop} 120ms ease-out`), prop);
  }
  for (const el of ["a:active", "button:active"])
    assert.match(
      moving.find((x) => x.selector === el)!.body,
      /transition-duration: 0s;/,
    );
  // Nowhere else does a transition run outside that media query.
  const loose = ALL.filter(
    (r) => /(^|\s)transition(-\w+)?:/.test(r.body) && !r.at.includes(MOTION),
  ).map((r) => `${r.file}: ${r.selector}`);
  assert.deepEqual(loose, []);
});
