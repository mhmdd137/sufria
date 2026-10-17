/**
 * The alert sound's state (brief م-ب §7): muted on this device through
 * `localStorage` — a storage that throws is «not muted», never an error —
 * which strip shows, and what rings when. A fake player stands in for Web
 * Audio. And the look of the strips and the button, read from their CSS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MUTED_KEY,
  createSoundStore,
  readMuted,
  soundStrip,
  type Player,
  type SoundKind,
} from "../../shared/sound/sound-store.ts";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

const throwing = (() => {
  throw new Error("SecurityError");
}) as () => Storage;

function fakePlayer(running: boolean) {
  const played: SoundKind[] = [];
  let loads = 0;
  const p: Player = {
    async play(kind) {
      if (!running) return false;
      played.push(kind);
      return true;
    },
    async resume() {
      return running;
    },
  };
  return {
    played,
    get loads() {
      return loads;
    },
    allow() {
      running = true;
    },
    load: async () => {
      loads++;
      return p;
    },
  };
}

test("🔴 localStorage throws: not muted, and no error", () => {
  assert.equal(readMuted(throwing), false);
  const store = createSoundStore({
    storage: throwing,
    loadPlayer: fakePlayer(true).load,
  });
  assert.equal(store.getSnapshot().muted, false);
  assert.doesNotThrow(() => store.setMuted(true));
  assert.equal(store.getSnapshot().muted, true, "for this page");
});

test("muted is «1» under sufria.sound.muted, and survives a new page", () => {
  const storage = memoryStorage();
  const first = createSoundStore({
    storage: () => storage,
    loadPlayer: fakePlayer(true).load,
  });
  first.setMuted(true);
  assert.equal(storage.getItem(MUTED_KEY), "1");
  const reloaded = createSoundStore({
    storage: () => storage,
    loadPlayer: fakePlayer(true).load,
  });
  assert.equal(reloaded.getSnapshot().muted, true);
  reloaded.setMuted(false);
  assert.equal(storage.getItem(MUTED_KEY), null);
});

test("muted: nothing rings, and the audio is not even loaded", async () => {
  const player = fakePlayer(true);
  const storage = memoryStorage();
  storage.setItem(MUTED_KEY, "1");
  const store = createSoundStore({
    storage: () => storage,
    loadPlayer: player.load,
  });
  await store.alert("order");
  assert.deepEqual(player.played, []);
  assert.equal(player.loads, 0);
});

test("the browser keeps the audio stopped: its strip; «شغّل الصوت» rings what was due", async () => {
  const player = fakePlayer(false);
  const store = createSoundStore({
    storage: memoryStorage,
    loadPlayer: player.load,
  });
  await store.alert("order");
  assert.equal(soundStrip(store.getSnapshot()), "blocked");
  player.allow();
  await store.enable();
  assert.equal(soundStrip(store.getSnapshot()), null);
  assert.deepEqual(player.played, ["order"]);
});

test("a press anywhere that lets the audio run takes the strip away", async () => {
  const store = createSoundStore({
    storage: memoryStorage,
    loadPlayer: fakePlayer(false).load,
  });
  await store.alert("message");
  assert.equal(store.getSnapshot().blocked, true);
  store.running();
  assert.equal(store.getSnapshot().blocked, false);
});

// --- a failure is the browser's strip, never silence (brief م-ب-9 §1) --------

/** A loader the test swaps: failing first, then a working fake. */
function swappable(first: () => Promise<Player>) {
  const working = fakePlayer(true);
  let load = first;
  return {
    played: working.played,
    fix() {
      load = working.load;
    },
    load: () => load(),
  };
}

test("🔴 the audio fails to load: the browser's strip and the sound due; «شغّل الصوت» rings it", async () => {
  const loader = swappable(() => Promise.reject(new Error("ChunkLoadError")));
  const store = createSoundStore({
    storage: memoryStorage,
    loadPlayer: loader.load,
  });
  await assert.doesNotReject(store.alert("message"));
  assert.equal(soundStrip(store.getSnapshot()), "blocked");
  loader.fix();
  await store.enable();
  assert.equal(soundStrip(store.getSnapshot()), null);
  assert.deepEqual(loader.played, ["message"]);
});

test("🔴 play throws: the same — the strip, and the sound due", async () => {
  const loader = swappable(async () => ({
    play: () => Promise.reject(new Error("InvalidStateError")),
    resume: async () => true,
  }));
  const store = createSoundStore({
    storage: memoryStorage,
    loadPlayer: loader.load,
  });
  await assert.doesNotReject(store.alert("order"));
  assert.equal(soundStrip(store.getSnapshot()), "blocked");
  loader.fix();
  await store.enable();
  assert.equal(soundStrip(store.getSnapshot()), null);
  assert.deepEqual(loader.played, ["order"]);
});

test("«شغّل الصوت» fails: the strip stays, nothing is thrown, and the next press works", async () => {
  const loader = swappable(async () => ({
    play: async () => false,
    resume: () => Promise.reject(new Error("NotAllowedError")),
  }));
  const store = createSoundStore({
    storage: memoryStorage,
    loadPlayer: loader.load,
  });
  await store.alert("order");
  await assert.doesNotReject(store.enable());
  assert.equal(store.getSnapshot().blocked, true);
  loader.fix();
  await store.enable();
  assert.equal(store.getSnapshot().blocked, false);
  assert.deepEqual(loader.played, ["order"]);
});

test("both strips due: «مكتوم» alone", () => {
  assert.equal(soundStrip({ muted: true, blocked: true }), "muted");
  assert.equal(soundStrip({ muted: false, blocked: true }), "blocked");
  assert.equal(soundStrip({ muted: false, blocked: false }), null);
});

const SOUND = fileURLToPath(new URL("../../shared/sound/", import.meta.url));
const LAYOUT = fileURLToPath(
  new URL("../../app/(dashboard)/", import.meta.url),
);
const HEADER = fileURLToPath(new URL("../../shared/layout/", import.meta.url));

function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

test("the strips: the surface and its line, not amber; 16/700 and 15/600; the button 15/700, 44px", () => {
  const css = readFileSync(`${SOUND}sound-strip.module.css`, "utf8");
  assert.doesNotMatch(css, /--paused-/);
  const strip = rule(css, ".strip");
  assert.ok(strip.includes("background: var(--surface);"));
  assert.ok(strip.includes("border-block-end: 1px solid var(--border);"));
  const muted = rule(css, '.strip[data-strip="muted"]');
  assert.ok(
    muted.includes("font-size: 16px;") && muted.includes("font-weight: 700;"),
  );
  const blocked = rule(css, '.strip[data-strip="blocked"]');
  assert.ok(
    blocked.includes("font-size: 15px;") &&
      blocked.includes("font-weight: 600;"),
  );
  const on = rule(css, ".on");
  for (const d of [
    "min-height: 44px;",
    "font-size: 15px;",
    "font-weight: 700;",
  ])
    assert.ok(on.includes(d), `.on: ${d}`);
});

test("the pause strip first, then the sound's; the button before «خروج», in its look", () => {
  const layout = readFileSync(`${LAYOUT}layout.tsx`, "utf8");
  assert.ok(
    layout.indexOf("<OrdersPausedStrip />") < layout.indexOf("<SoundStrip />"),
  );
  const header = readFileSync(`${HEADER}dashboard-header.tsx`, "utf8");
  const soundButton = header.indexOf("S.unmute : S.mute");
  const logout = header.indexOf("{T.logout}");
  assert.ok(soundButton !== -1 && soundButton < logout);
  const buttons = [...header.matchAll(/className=\{styles\.logout\}/g)];
  assert.equal(buttons.length, 2, "the sound's button wears logout's class");
});

test("the audio is loaded with import(), never with the page", () => {
  const store = readFileSync(`${SOUND}sound-store.ts`, "utf8");
  assert.match(store, /import\("\.\/player\.ts"\)/);
  assert.doesNotMatch(store, /^import .* from "\.\/player\.ts";/m);
});
