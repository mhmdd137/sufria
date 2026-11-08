/**
 * A customer's image and its viewer (brief م-هـ-ب §5.1, §5.3, mhb-6): the
 * crop's decision as a pure function, and what only a browser would show
 * held by reading the TSX and the CSS, as card.test.mts does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isCropped } from "../../features/orders/lib/media.ts";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${WEB}${path}`, "utf8");
const CSS = read("features/orders/components/media-message.module.css");
const TSX = read("features/orders/components/media-message.tsx");

/** The body of `selector`'s rule at the top level, or inside `at`. */
function rule(css: string, selector: string, at: string | null = null) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const scope =
    at === null
      ? src.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      : (src.match(
          new RegExp(
            `${at.replace(/[()]/g, "\\$&")}\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`,
          ),
        )?.[1] ?? "");
  const m = scope.match(
    new RegExp(
      `(?:^|\\}|\\s)${selector.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  );
  return m?.[1] ?? null;
}

test("isCropped: a transfer's long screenshot in the 318×320 frame — cut", () => {
  assert.equal(isCropped(1125, 2436, 318, 320), true);
});

test("isCropped: a wide image — its frame takes its ratio, nothing cut", () => {
  // 1600×1200 at 318 wide: 238.5 tall, under the 320 cap.
  assert.equal(isCropped(1600, 1200, 318, 238.5), false);
  assert.equal(isCropped(1600, 1200, 318, 238), false);
});

test("isCropped: the same ratio — nothing cut; nothing measured — nothing cut", () => {
  assert.equal(isCropped(1000, 1000, 320, 320), false);
  assert.equal(isCropped(0, 0, 318, 320), false);
  assert.equal(isCropped(1125, 2436, 0, 0), false);
});

test("🔴 «عرض الكل» only when the image is cut: its condition is isCropped's, measured after load and on resize", () => {
  assert.match(TSX, /setCropped\(\s*isCropped\(/);
  assert.match(TSX, /\{url !== null && cropped && \(\s*<button/);
  assert.match(TSX, /addEventListener\("resize", measure\)/);
  assert.match(TSX, /onLoad=\{/);
  // A press on the image opens the viewer, cut or not.
  assert.match(
    TSX,
    /className=\{styles\.zoom\}[\s\S]*?onClick=\{\(\) => setOpen\(true\)\}/,
  );
});

test("the frame: 320px at the most, the image cover from its middle; the li the conversation's width up to 360", () => {
  assert.match(rule(CSS, ".frame")!, /max-height: 320px;/);
  const image = rule(CSS, ".image")!;
  assert.match(image, /object-fit: cover;/);
  assert.match(image, /object-position: 50% 50%;/);
  const chat = read("features/orders/components/conversation.module.css");
  const li = rule(chat, '.message[data-media="image"]')!;
  assert.match(li, /width: min\(100%, 360px\);/);
  assert.match(li, /max-width: none;/);
});

test("the image's button: zoom-in, no pointer, no hover or pressed look (the viewer is the answer)", () => {
  assert.match(rule(CSS, ".zoom")!, /cursor: zoom-in;/);
  assert.doesNotMatch(CSS, /\.zoom[^{]*:(hover|active)/);
});

test("🔴 the viewer: the whole screen at every width, Chrome's own limits undone, shown flex only while open", () => {
  const viewer = rule(CSS, ".viewer")!;
  for (const d of [
    "inset: 0;",
    "width: auto;",
    "height: auto;",
    "max-width: none;",
    "max-height: none;",
    "margin: 0;",
    "padding: 0;",
    "overflow: hidden;",
  ])
    assert.ok(viewer.includes(d), d);
  assert.doesNotMatch(viewer, /display:/);
  assert.doesNotMatch(CSS, /\d(d?vh)\b/);
  assert.match(rule(CSS, ".viewer[open]")!, /display: flex;/);
});

test("🔴 the two screens: below 640 the image scrolls at the screen's width; the whole image inside the screen only from 640", () => {
  const below = rule(CSS, ".viewerImage")!;
  assert.match(below, /width: 100%;/);
  assert.match(below, /height: auto;/);
  assert.doesNotMatch(below, /max-height/);
  assert.match(rule(CSS, ".viewerBody")!, /overflow-y: auto;/);
  const MQ = "@media (min-width: 640px)";
  const above = rule(CSS, ".viewerImage", MQ)!;
  assert.match(above, /max-width: 100%;/);
  assert.match(above, /max-height: 100%;/);
  assert.match(above, /width: auto;/);
  const body = rule(CSS, ".viewerBody", MQ)!;
  assert.match(body, /justify-content: center;/);
  assert.match(body, /align-items: center;/);
});

test("the viewer: «المجموع» and the order's total in the numbers' font, «رجوع», a hidden title — and no step inside it", () => {
  assert.match(TSX, /T\.details\.total/);
  assert.match(TSX, /className=\{`num \$\{styles\.viewerAmount\}`\}/);
  assert.match(TSX, /T\.cancel\.back/);
  assert.match(TSX, /className="visually-hidden"/);
  assert.doesNotMatch(TSX, /NextStepButton|nextStaffAction|changeStatus/);
  assert.match(rule(CSS, ".viewerAmount")!, /font-size: 19px;/);
});

test("Dialog without className is the 420px window as before (the cancel and the menu's dialogs)", () => {
  const dialog = read("shared/ui/dialog.tsx");
  assert.match(dialog, /className=\{className \?\? styles\.dialog\}/);
  assert.match(read("shared/ui/dialog.module.css"), /max-width: 420px;/);
  assert.doesNotMatch(
    read("features/orders/components/cancel-dialog.tsx"),
    /<Dialog[^>]*className=/,
  );
  assert.doesNotMatch(
    read("features/menu/components/confirm-dialog.tsx"),
    /<Dialog[^>]*className=/,
  );
});
