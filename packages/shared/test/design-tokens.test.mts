/**
 * The contrast gate's logic (brief G §3, G-1): the pairs come from the token
 * source, the locked values pass, and the brief's break control — «جاهز» text
 * at #E0C060 — fails by the name of its pair.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COLOR_MODES,
  COLOR_TOKENS,
  MIN_TEXT_CONTRAST,
  ORDER_STATUSES,
  STATUS_BADGE_COLORS,
  TEXT_ON_BACKGROUND,
  checkedTextVariables,
  contrastPairs,
  contrastRatio,
  designTokensCss,
} from "@sufria/shared";

test("contrastRatio: the WCAG endpoints", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  assert.equal(contrastRatio("#FFFFFF", "#000000"), 21);
  assert.throws(() => contrastRatio("#FFF", "#000000"));
});

test("every locked pair passes 4.5:1, and the weakest is 4.62 (text-secondary on bg-press, light)", () => {
  // Brief ل §2: 52 pairs — the 28 before it and 12 more in each mode. The
  // weakest was «expired» (light, 5.00) until the pressed grounds came.
  const pairs = contrastPairs();
  assert.equal(pairs.length, 52);
  for (const p of pairs)
    assert.ok(p.ratio >= MIN_TEXT_CONTRAST, `${p.name}: ${p.ratio.toFixed(2)}`);
  const weakest = pairs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  assert.equal(weakest.name, "light · text-secondary on bg-press");
  assert.equal(weakest.ratio.toFixed(2), "4.62");
});

test("🔴 the eight hover and press grounds: their values, each the brief's sRGB mix, and every text that falls on them in the gate", () => {
  // Brief ل §2 (Mohammed, 12 October). The values, then the method that
  // made them: a value edited by hand stops being its mix.
  const expected = {
    light: {
      "surface-hover": "#ECECEC",
      "surface-press": "#DADADA",
      "bg-hover": "#E5E5E3",
      "bg-press": "#D3D3D1",
      "accent-hover": "#63223F",
      "accent-press": "#521C34",
      "inverse-hover": "#222221",
      "inverse-press": "#2F2F2E",
    },
    dark: {
      "surface-hover": "#2C2C29",
      "surface-press": "#383835",
      "bg-hover": "#242422",
      "bg-press": "#31312F",
      "accent-hover": "#A34168",
      "accent-press": "#943B5F",
      "inverse-hover": "#DFDEDC",
      "inverse-press": "#CECDCA",
    },
  } as const;
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (from: string, to: string, share: number) =>
    "#" +
    rgb(from)
      .map((c, i) => Math.round(c + (rgb(to)[i]! - c) * share))
      .map((c) => c.toString(16).padStart(2, "0").toUpperCase())
      .join("");
  const shares = {
    light: {
      ground: [0.08, 0.16],
      accent: [0.15, 0.3],
      inverse: [0.055, 0.11],
    },
    dark: {
      ground: [0.06, 0.12],
      accent: [0.1, 0.18],
      inverse: [0.085, 0.165],
    },
  } as const;
  for (const mode of COLOR_MODES) {
    const c = COLOR_TOKENS[mode];
    const s = shares[mode];
    for (const [token, value] of Object.entries(expected[mode]))
      assert.equal(c[token as keyof typeof c], value, `${mode} ${token}`);
    assert.equal(
      c["surface-hover"],
      mix(c.surface, c["text-primary"], s.ground[0]),
    );
    assert.equal(
      c["surface-press"],
      mix(c.surface, c["text-primary"], s.ground[1]),
    );
    assert.equal(c["bg-hover"], mix(c.bg, c["text-primary"], s.ground[0]));
    assert.equal(c["bg-press"], mix(c.bg, c["text-primary"], s.ground[1]));
    assert.equal(c["accent-hover"], mix(c.accent, "#000000", s.accent[0]));
    assert.equal(c["accent-press"], mix(c.accent, "#000000", s.accent[1]));
    assert.equal(
      c["inverse-hover"],
      mix(c["text-primary"], c.bg, s.inverse[0]),
    );
    assert.equal(
      c["inverse-press"],
      mix(c["text-primary"], c.bg, s.inverse[1]),
    );
  }

  const names = new Set(contrastPairs().map((p) => p.name));
  for (const mode of COLOR_MODES) {
    for (const text of ["text-primary", "text-secondary"])
      for (const ground of [
        "surface-hover",
        "surface-press",
        "bg-hover",
        "bg-press",
      ])
        assert.ok(
          names.has(`${mode} · ${text} on ${ground}`),
          `${mode} ${text} ${ground}`,
        );
    for (const ground of ["accent-hover", "accent-press"])
      assert.ok(
        names.has(`${mode} · on-accent on ${ground}`),
        `${mode} ${ground}`,
      );
    for (const ground of ["inverse-hover", "inverse-press"])
      assert.ok(names.has(`${mode} · bg on ${ground}`), `${mode} ${ground}`);
  }
  // text-muted is a line's colour under the pointer, never a text (§3).
  assert.ok(!("text-muted" in TEXT_ON_BACKGROUND));
});

test("the pairs are enumerated from the source: every badge × both modes", () => {
  const names = new Set(contrastPairs().map((p) => p.name));
  for (const mode of COLOR_MODES)
    for (const status of ORDER_STATUSES)
      assert.ok(names.has(`${mode} · badge ${status}`), `${mode} ${status}`);
  const textPairs = Object.values(TEXT_ON_BACKGROUND).reduce(
    (n, bgs) => n + (bgs?.length ?? 0),
    0,
  );
  assert.equal(
    contrastPairs().length,
    COLOR_MODES.length * (textPairs + ORDER_STATUSES.length),
  );
});

test("🔴 break control: «جاهز» text at #E0C060 fails, by the name of its pair", () => {
  const broken = structuredClone(STATUS_BADGE_COLORS);
  broken.ready.light.text = "#E0C060";
  const failing = contrastPairs(
    COLOR_TOKENS,
    TEXT_ON_BACKGROUND,
    broken,
  ).filter((p) => p.ratio < MIN_TEXT_CONTRAST);
  assert.deepEqual(
    failing.map((p) => p.name),
    ["light · badge ready"],
  );
});

test("🔴 text-muted (light) and accent (dark) are not text colours — they miss 4.5:1", () => {
  // Why TEXT_ON_BACKGROUND leaves them out. If a token change ever lifts
  // them over 4.5, this test says so, and they can become text colours.
  assert.ok(
    contrastRatio(
      COLOR_TOKENS.light["text-muted"],
      COLOR_TOKENS.light.surface,
    ) < MIN_TEXT_CONTRAST,
  );
  assert.ok(
    contrastRatio(COLOR_TOKENS.dark.accent, COLOR_TOKENS.dark.surface) <
      MIN_TEXT_CONTRAST,
  );
  assert.ok(!("text-muted" in TEXT_ON_BACKGROUND));
  assert.ok(!("accent" in TEXT_ON_BACKGROUND));
  assert.ok(!checkedTextVariables().includes("--text-muted"));
});

test("🔴 «مطفأ» inverted — `bg` on `text-primary` — is in the gate, in both modes", () => {
  // Brief ي-ب-9 §4.1: the menu row's switched-off word.
  const pairs = contrastPairs();
  for (const mode of COLOR_MODES) {
    const pair = pairs.find((p) => p.name === `${mode} · bg on text-primary`);
    assert.ok(pair, mode);
    assert.equal(pair.text, COLOR_TOKENS[mode].bg);
    assert.equal(pair.background, COLOR_TOKENS[mode]["text-primary"]);
    // About 16:1 (brief ي-ب-9 §4.1): 16.88 light, 15.89 dark.
    assert.ok(pair.ratio >= 15, `${mode}: ${pair.ratio.toFixed(2)}`);
  }
  assert.ok(checkedTextVariables().includes("--bg"));
});

test("🔴 the pause strip's amber — `paused-text` on `paused-bg` — is in the gate, in both modes, under names of its own", () => {
  // Brief ي-ب-9 §4.5: «بانتظار القبول»'s values today, its own tokens.
  const expected = {
    light: { bg: "#FCE8D6", text: "#8A4A0A" },
    dark: { bg: "#43290F", text: "#F2B577" },
  } as const;
  const pairs = contrastPairs();
  for (const mode of COLOR_MODES) {
    assert.equal(COLOR_TOKENS[mode]["paused-bg"], expected[mode].bg);
    assert.equal(COLOR_TOKENS[mode]["paused-text"], expected[mode].text);
    const pair = pairs.find(
      (p) => p.name === `${mode} · paused-text on paused-bg`,
    );
    assert.ok(pair, mode);
    // 5.76 light, 7.46 dark.
    assert.ok(pair.ratio >= MIN_TEXT_CONTRAST, `${mode}: ${pair.ratio}`);
  }
  assert.ok(checkedTextVariables().includes("--paused-text"));
  assert.match(designTokensCss(), /--paused-bg:#FCE8D6;/);
});

test("designTokensCss: every token, light by default and dark by the device", () => {
  const css = designTokensCss();
  const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
  for (const [token, value] of Object.entries(COLOR_TOKENS.light))
    assert.ok(light!.includes(`--${token}:${value};`), token);
  for (const [token, value] of Object.entries(COLOR_TOKENS.dark))
    assert.ok(dark!.includes(`--${token}:${value};`), token);
  for (const status of ORDER_STATUSES) {
    assert.ok(
      light!.includes(
        `--badge-${status}-text:${STATUS_BADGE_COLORS[status].light.text};`,
      ),
    );
    assert.ok(
      dark!.includes(
        `--badge-${status}-bg:${STATUS_BADGE_COLORS[status].dark.bg};`,
      ),
    );
  }
});
