/**
 * A customer's voice note and PDF on the order's page (brief م-هـ-ب §5.4,
 * §5.5, mhb-7): the player's time and states, the page's one player with a
 * stand-in `Audio`, and «افتح الملف» with a stand-in tab — the order of the
 * calls is the point: Safari allows the sound and the tab only inside the
 * press, before any `await`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SILENT_AUDIO,
  audioReducer,
  audioView,
  createAudioPlayer,
  minSec,
  type AudioEvent,
  type AudioLike,
  type AudioState,
} from "../../features/orders/lib/audio.ts";
import type { MediaEntry } from "../../features/orders/lib/media.ts";
import {
  PDF_URL_LIFETIME_MS,
  openPdf,
  type TabLike,
} from "../../features/orders/lib/pdf.ts";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${WEB}${path}`, "utf8");

// --- the time ---------------------------------------------------------------

test("minSec: 0 · 9 · 65 · 600 · Infinity · NaN", () => {
  assert.deepEqual([0, 9, 65, 600, Infinity, NaN].map(minSec), [
    "0:00",
    "0:09",
    "1:05",
    "10:00",
    "0:00",
    "0:00",
  ]);
  assert.equal(minSec(4.9), "0:04");
});

test("audioView: §5.4's table — label, working, «أوقف» with the time, stopped, ended, the length not a number", () => {
  const v = (s: AudioState) => audioView(s);
  assert.deepEqual(v({ kind: "idle" }), {
    kind: "player",
    button: "listen",
    busy: false,
    time: null,
  });
  assert.deepEqual(v({ kind: "loading" }), {
    kind: "player",
    button: "listen",
    busy: true,
    time: null,
  });
  assert.deepEqual(v({ kind: "playing", current: 4, duration: 12 }), {
    kind: "player",
    button: "stop",
    busy: false,
    time: "0:04 / 0:12",
  });
  assert.deepEqual(v({ kind: "paused", current: 4, duration: 12 }), {
    kind: "player",
    button: "listen",
    busy: false,
    time: "0:04 / 0:12",
  });
  assert.deepEqual(v({ kind: "ended", duration: 12 }), {
    kind: "player",
    button: "listen",
    busy: false,
    time: "0:12",
  });
  for (const duration of [Infinity, NaN])
    assert.equal(
      (v({ kind: "playing", current: 4, duration }) as { time: string }).time,
      "0:04",
    );
  assert.deepEqual(v({ kind: "broken" }), { kind: "broken" });
});

// --- the states -------------------------------------------------------------

const run = (events: AudioEvent[], from: AudioState = { kind: "idle" }) =>
  events.reduce(audioReducer, from);

test("audioReducer: press, file, play, the time, stop, to its end", () => {
  assert.deepEqual(run([{ type: "load" }]), { kind: "loading" });
  assert.deepEqual(
    run([{ type: "load" }, { type: "playing", current: 0, duration: 12 }]),
    { kind: "playing", current: 0, duration: 12 },
  );
  assert.deepEqual(
    run([
      { type: "playing", current: 0, duration: 12 },
      { type: "time", current: 4, duration: 12 },
      { type: "pause", current: 4, duration: 12 },
    ]),
    { kind: "paused", current: 4, duration: 12 },
  );
  assert.deepEqual(
    run([
      { type: "playing", current: 0, duration: 12 },
      { type: "pause", current: 12, duration: 12 },
      { type: "ended", duration: 12 },
    ]),
    { kind: "ended", duration: 12 },
  );
  // The time of a voice note not playing changes nothing.
  assert.deepEqual(run([{ type: "time", current: 3, duration: 12 }]), {
    kind: "idle",
  });
});

test("audioReducer: a failed download — «استمع» again; the third — its word", () => {
  assert.deepEqual(
    run([{ type: "load" }, { type: "loadFailed", gaveUp: false }]),
    {
      kind: "idle",
    },
  );
  assert.deepEqual(
    run([{ type: "load" }, { type: "loadFailed", gaveUp: true }]),
    {
      kind: "broken",
    },
  );
});

test("🔴 audioReducer: NotAllowedError — «استمع», ready for the next press; NotSupportedError — its word", () => {
  assert.deepEqual(
    run([{ type: "load" }, { type: "playFailed", name: "NotAllowedError" }]),
    { kind: "idle" },
  );
  assert.deepEqual(
    run([{ type: "load" }, { type: "playFailed", name: "AbortError" }]),
    { kind: "idle" },
  );
  assert.deepEqual(
    run([{ type: "load" }, { type: "playFailed", name: "NotSupportedError" }]),
    { kind: "broken" },
  );
  // Broken stays broken.
  assert.deepEqual(run([{ type: "load" }], { kind: "broken" }), {
    kind: "broken",
  });
});

test("audioReducer: stopped by another voice note — where it was, or «استمع» before it started", () => {
  assert.deepEqual(
    run([{ type: "stopped", current: 5, duration: 12 }], {
      kind: "playing",
      current: 5,
      duration: 12,
    }),
    { kind: "paused", current: 5, duration: 12 },
  );
  assert.deepEqual(
    run([{ type: "stopped", current: 0, duration: 0 }], { kind: "loading" }),
    { kind: "idle" },
  );
});

// --- the page's one player --------------------------------------------------

type Fake = AudioLike & {
  log: string[];
  fire(type: string): void;
  rejectNext: string | null;
};

function fakeAudio(log: string[]): Fake {
  const on = new Map<string, Array<() => void>>();
  const a: Fake = {
    log,
    src: "",
    currentTime: 0,
    duration: 12,
    paused: true,
    error: null,
    rejectNext: null,
    play() {
      log.push(`play ${a.src === SILENT_AUDIO ? "silent" : a.src}`);
      if (a.rejectNext) {
        const name = a.rejectNext;
        a.rejectNext = null;
        const err = new Error(name);
        err.name = name;
        return Promise.reject(err);
      }
      (a as { paused: boolean }).paused = false;
      if (a.src !== SILENT_AUDIO) queueMicrotask(() => a.fire("playing"));
      return Promise.resolve();
    },
    pause() {
      log.push("pause");
      (a as { paused: boolean }).paused = true;
      queueMicrotask(() => a.fire("pause"));
    },
    addEventListener(type, listener) {
      on.set(type, [...(on.get(type) ?? []), listener]);
    },
    fire(type) {
      for (const l of on.get(type) ?? []) l();
    },
  };
  return a;
}

const flush = () => new Promise((r) => setImmediate(r));

function player(entries: Record<string, MediaEntry>) {
  const log: string[] = [];
  let made = 0;
  const audio = fakeAudio(log);
  const gates: Array<() => void> = [];
  const p = createAudioPlayer({
    createAudio: () => {
      made++;
      return audio;
    },
    load: async (id) => {
      log.push(`load ${id}`);
      await new Promise<void>((resolve) => gates.push(resolve));
      return entries[id]!;
    },
    gaveUp: () => false,
  });
  const release = async () => {
    while (gates.length) gates.shift()!();
    await flush();
  };
  return { p, log, audio, release, made: () => made };
}

const ready = (url: string): MediaEntry => ({
  kind: "ready",
  blob: new Blob([]),
  url,
});

function voice() {
  let state: AudioState = { kind: "idle" };
  return {
    listen: (e: AudioEvent) => {
      state = audioReducer(state, e);
    },
    get: () => state,
  };
}

test("🔴 the press: the silent clip plays before the download is asked for, then the file", async () => {
  const { p, log, release, made } = player({ a: ready("blob:a") });
  const a = voice();
  p.press("a", a.listen);
  // Inside the press: the element, the silent clip, then the download.
  assert.deepEqual(log, ["play silent", "load a"]);
  assert.deepEqual(a.get(), { kind: "loading" });
  await release();
  assert.deepEqual(log, ["play silent", "load a", "play blob:a"]);
  assert.equal(a.get().kind, "playing");
  assert.equal(made(), 1);
});

test("🔴 one voice note at a time: the second stops the first, on the page's one element", async () => {
  const { p, audio, release, made } = player({
    a: ready("blob:a"),
    b: ready("blob:b"),
  });
  const a = voice();
  const b = voice();
  p.press("a", a.listen);
  await release();
  audio.currentTime = 5;
  p.press("b", b.listen);
  await release();
  assert.deepEqual(a.get(), { kind: "paused", current: 5, duration: 12 });
  assert.equal(b.get().kind, "playing");
  assert.equal(audio.src, "blob:b");
  assert.equal(made(), 1);
});

test("«أوقف» on the one playing pauses it; «استمع» again plays the same file, no download", async () => {
  const { p, log, audio, release } = player({ a: ready("blob:a") });
  const a = voice();
  p.press("a", a.listen);
  await release();
  audio.currentTime = 3;
  p.press("a", a.listen);
  await flush();
  assert.deepEqual(a.get(), { kind: "paused", current: 3, duration: 12 });
  p.press("a", a.listen);
  await flush();
  assert.equal(a.get().kind, "playing");
  assert.equal(log.filter((l) => l.startsWith("load")).length, 1);
});

test("NotAllowedError after the download: «استمع», and the next press plays the file at once", async () => {
  const { p, log, audio, release } = player({ a: ready("blob:a") });
  const a = voice();
  p.press("a", a.listen);
  // The silent clip played inside the press; the file's play is refused.
  audio.rejectNext = "NotAllowedError";
  await release();
  assert.deepEqual(a.get(), { kind: "idle" });
  p.press("a", a.listen);
  await flush();
  assert.equal(a.get().kind, "playing");
  assert.deepEqual(log.slice(-1), ["play blob:a"]);
});

test("the page closes: the one playing stops", async () => {
  const { p, log, release } = player({ a: ready("blob:a") });
  p.press("a", voice().listen);
  await release();
  p.dispose();
  assert.ok(log.includes("pause"));
});

// --- «افتح الملف» -----------------------------------------------------------

function pdfDeps(entry: MediaEntry, tab: TabLike | null) {
  const log: string[] = [];
  let resolve!: () => void;
  const created: Blob[] = [];
  const timers: number[] = [];
  return {
    log,
    created,
    timers,
    answer: () => resolve(),
    deps: {
      openTab: () => {
        log.push("open");
        return tab;
      },
      load: async () => {
        log.push("load");
        await new Promise<void>((r) => (resolve = r));
        log.push("loaded");
        return entry;
      },
      createUrl: (blob: Blob) => {
        created.push(blob);
        return "blob:pdf";
      },
      revokeUrl: (url: string) => log.push(`revoke ${url}`),
      download: (url: string, name: string) =>
        log.push(`download ${url} ${name}`),
      later: (run: () => void, ms: number) => {
        timers.push(ms);
        log.push("later");
        void run;
      },
    },
  };
}

const tabFake = () => {
  const t = {
    opener: "the dashboard" as unknown,
    location: { href: "" },
    closed: false,
    close() {
      t.closed = true;
    },
  };
  return t;
};

const PDF = new Blob(["%PDF-1.4"], { type: "text/html" });

test("🔴 «افتح الملف»: the tab opens before the download ends, cut from the page; then the file, a new Blob of type application/pdf", async () => {
  const tab = tabFake();
  const d = pdfDeps({ kind: "ready", blob: PDF, url: "blob:raw" }, tab);
  const outcome = openPdf(d.deps, "receipt.pdf");
  // Before any answer: the tab is open, and its opener cut.
  assert.deepEqual(d.log, ["open", "load"]);
  assert.equal(tab.opener, null);
  d.answer();
  assert.equal(await outcome, "opened");
  assert.equal(tab.location.href, "blob:pdf");
  assert.equal(d.created.length, 1);
  assert.equal(d.created[0]!.type, "application/pdf");
  assert.notEqual(d.created[0], PDF);
  assert.deepEqual(d.timers, [PDF_URL_LIFETIME_MS]);
  assert.equal(PDF_URL_LIFETIME_MS, 60_000);
});

test("«افتح الملف»: no tab (the browser refused it) — a link with download and the file's name", async () => {
  const d = pdfDeps({ kind: "ready", blob: PDF, url: "blob:raw" }, null);
  const outcome = openPdf(d.deps, "receipt.pdf");
  d.answer();
  assert.equal(await outcome, "downloaded");
  assert.ok(d.log.includes("download blob:pdf receipt.pdf"));
});

test("«افتح الملف»: the download failed — the tab closes again, and the row says why", async () => {
  const tab = tabFake();
  const d = pdfDeps(
    { kind: "failed", failures: 1, error: { kind: "network" } },
    tab,
  );
  const outcome = openPdf(d.deps, null);
  d.answer();
  assert.equal(await outcome, "failed");
  assert.equal(tab.closed, true);
  assert.equal(tab.location.href, "");
  assert.equal(d.created.length, 0);
});

test("the row's look: the player's and the PDF's buttons are .lineButton, the time in the numbers' font left to right, the failure the step's line", () => {
  const tsx = read("features/orders/components/media-message.tsx");
  assert.equal(tsx.match(/className=\{chat\.lineButton\}/g)?.length, 2);
  assert.match(tsx, /className=\{`num \$\{styles\.audioTime\}`\}\s*dir="ltr"/);
  assert.match(tsx, /T\.errors\.stepFailed/);
  assert.match(tsx, /<bdi dir="ltr" className=\{styles\.fileName\}>/);
  const css = read("features/orders/components/media-message.module.css");
  assert.match(css, /\.fileName \{[^}]*text-overflow: ellipsis;[^}]*\}/);
});
