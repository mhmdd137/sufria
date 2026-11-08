/**
 * The light and dark button (brief م-هـ-ب §9ب, Mohammed's decisions 9–11):
 * the choice read and kept on this device, the page's mode, the button's
 * word, and the script before the first paint — run in a context of its
 * own with a stand-in `localStorage` and `document`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import {
  THEME_KEY,
  THEME_SCRIPT,
  currentMode,
  otherMode,
  parseTheme,
  readStoredTheme,
  storeTheme,
  themeButtonLabel,
} from "../../shared/theme/theme.ts";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${WEB}${path}`, "utf8");

const storage = (value: string | null) => ({
  getItem: (key: string) => (key === THEME_KEY ? value : null),
});
const refusing = () => {
  throw new Error("SecurityError");
};

test("reading the choice: light · dark · a wrong value · storage that throws · no storage", () => {
  assert.equal(
    readStoredTheme(() => storage("light")),
    "light",
  );
  assert.equal(
    readStoredTheme(() => storage("dark")),
    "dark",
  );
  assert.equal(
    readStoredTheme(() => storage("Dark")),
    null,
  );
  assert.equal(
    readStoredTheme(() => storage("system")),
    null,
  );
  assert.equal(
    readStoredTheme(() => storage(null)),
    null,
  );
  assert.equal(readStoredTheme(refusing), null);
  assert.equal(
    readStoredTheme(() => ({
      getItem: () => {
        throw new Error("denied");
      },
    })),
    null,
  );
  assert.equal(
    readStoredTheme(() => null),
    null,
  );
  assert.equal(parseTheme(undefined), null);
});

test("keeping the choice: one key; storage that refuses — false, the page's mode alone", () => {
  const kept: [string, string][] = [];
  assert.equal(
    storeTheme(() => ({ setItem: (k, v) => void kept.push([k, v]) }), "dark"),
    true,
  );
  assert.deepEqual(kept, [["sufria-theme", "dark"]]);
  assert.equal(storeTheme(refusing, "light"), false);
  assert.equal(
    storeTheme(
      () => ({
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
      "light",
    ),
    false,
  );
});

test("the page's mode: the choice on <html>, else the device", () => {
  assert.equal(currentMode("dark", false), "dark");
  assert.equal(currentMode("light", true), "light");
  assert.equal(currentMode(null, true), "dark");
  assert.equal(currentMode(null, false), "light");
  assert.equal(currentMode("sepia", true), "dark");
});

test("🔴 the button's word is the mode it takes you to: «غامق» on a light page, «فاتح» on a dark one", () => {
  assert.equal(themeButtonLabel("light"), "غامق");
  assert.equal(themeButtonLabel("dark"), "فاتح");
  assert.equal(otherMode("light"), "dark");
  assert.equal(otherMode("dark"), "light");
});

function runScript(stored: string | null | "throw") {
  const set: [string, string][] = [];
  const context = {
    localStorage: {
      getItem: (key: string) => {
        if (stored === "throw") throw new Error("SecurityError");
        return key === "sufria-theme" ? stored : null;
      },
    },
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => void set.push([k, v]),
      },
    },
  };
  runInNewContext(THEME_SCRIPT, context);
  return set;
}

test("🔴 the script before the paint: data-theme for light and dark alone — anything else, nothing", () => {
  assert.deepEqual(runScript("light"), [["data-theme", "light"]]);
  assert.deepEqual(runScript("dark"), [["data-theme", "dark"]]);
  for (const value of [null, "", "sepia", "LIGHT", "dark "])
    assert.deepEqual(runScript(value), [], String(value));
});

test("the script before the paint: storage that throws — no error, nothing set", () => {
  assert.doesNotThrow(() => runScript("throw"));
  assert.deepEqual(runScript("throw"), []);
  assert.match(
    THEME_SCRIPT,
    /^\(function\(\)\{try\{[\s\S]*\}catch\(e\)\{\}\}\)\(\);$/,
  );
});

test("the layout: the script first in <head>, before the colours; suppressHydrationWarning on <html> alone", () => {
  const layout = read("app/layout.tsx");
  const head = layout.slice(layout.indexOf("<head>"));
  assert.ok(head.indexOf("THEME_SCRIPT") < head.indexOf("designTokensCss()"));
  assert.ok(head.indexOf("<script") < head.indexOf("<style"));
  // The attribute itself, not the comment that says why.
  assert.equal(layout.match(/^\s+suppressHydrationWarning$/gm)?.length, 1);
  assert.match(layout, /<html[\s\S]*?suppressHydrationWarning[\s\S]*?>/);
});

test("the header: the button after the sound's and before logout, in their look (styles.logout)", () => {
  const header = read("shared/layout/dashboard-header.tsx");
  const sound = header.indexOf("sound.setMuted");
  const theme = header.indexOf("<ThemeButton");
  const logout = header.indexOf("onClick={onLogout}");
  assert.ok(sound !== -1 && sound < theme && theme < logout);
  assert.match(header, /<ThemeButton className=\{styles\.logout\} \/>/);
  const button = read("shared/theme/theme-button.tsx");
  assert.doesNotMatch(button, /aria-pressed=/);
  assert.match(button, /themeButtonLabel\(mode\)/);
  // Kept on the device alone: no call to the API.
  assert.doesNotMatch(button, /fetch\(|ordersApi|\/api\//);
});
