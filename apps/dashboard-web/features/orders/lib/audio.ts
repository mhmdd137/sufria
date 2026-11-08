/**
 * A customer's voice note on the order's page (brief م-هـ-ب §5.4, decisions
 * 6 and 7 of the brief), apart from React: its states as a reducer, its
 * time, and the page's one player — one `Audio` for every voice note, so a
 * second one stops the first.
 */
import type { MediaEntry } from "./media.ts";

export type AudioState =
  /** Never played: «استمع» and «رسالة صوتية». */
  | { kind: "idle" }
  /** Its file on the way: «استمع», working. */
  | { kind: "loading" }
  | { kind: "playing"; current: number; duration: number }
  /** Stopped midway: «استمع» and where it stopped. */
  | { kind: "paused"; current: number; duration: number }
  /** To its end: «استمع» (from the start) and its length. */
  | { kind: "ended"; duration: number }
  /** It does not play: the bubble is «رسالة صوتية — لا تظهر هنا». */
  | { kind: "broken" };

export type AudioEvent =
  | { type: "load" }
  /** The download failed; `gaveUp` after the third. */
  | { type: "loadFailed"; gaveUp: boolean }
  | { type: "playing"; current: number; duration: number }
  | { type: "time"; current: number; duration: number }
  | { type: "pause"; current: number; duration: number }
  | { type: "ended"; duration: number }
  /** `play()` refused, or the element failed: the error's `name`. */
  | { type: "playFailed"; name: string }
  /** Another voice note took the player, or the page closed. */
  | { type: "stopped"; current: number; duration: number };

/**
 * `NotAllowedError` — Safari would not start it after the download: back to
 * «استمع» with the file ready, and the next press plays (a known gap).
 * `AbortError` — a new source cut the old one: the same. Anything else —
 * `NotSupportedError` first (Opus on iOS before 18.4) — does not play.
 */
export function audioReducer(state: AudioState, event: AudioEvent): AudioState {
  if (state.kind === "broken") return state;
  switch (event.type) {
    case "load":
      return { kind: "loading" };
    case "loadFailed":
      return event.gaveUp ? { kind: "broken" } : { kind: "idle" };
    case "playing":
      return {
        kind: "playing",
        current: event.current,
        duration: event.duration,
      };
    case "time":
      return state.kind === "playing" || state.kind === "paused"
        ? { ...state, current: event.current, duration: event.duration }
        : state;
    case "pause":
      return state.kind === "playing"
        ? { kind: "paused", current: event.current, duration: event.duration }
        : state;
    case "ended":
      return { kind: "ended", duration: event.duration };
    case "playFailed":
      return event.name === "NotAllowedError" || event.name === "AbortError"
        ? { kind: "idle" }
        : { kind: "broken" };
    case "stopped":
      return state.kind === "playing" ||
        state.kind === "paused" ||
        state.kind === "loading"
        ? event.current > 0
          ? { kind: "paused", current: event.current, duration: event.duration }
          : { kind: "idle" }
        : state;
  }
}

/** «0:04»: whole seconds, the minutes unpadded. Not a finite number: 0. */
export function minSec(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * What the player shows beside its button (§5.4's table): the label before
 * the first play and while it loads, then «0:04 / 0:12» — the elapsed time
 * alone when the length is not a finite number (`Infinity` · `NaN`) — and
 * its length once it ended.
 */
export type AudioView =
  | { kind: "broken" }
  | {
      kind: "player";
      /** «استمع», or «أوقف» while it plays. */
      button: "listen" | "stop";
      busy: boolean;
      /** `null`: the label «رسالة صوتية» instead. */
      time: string | null;
    };

export function audioView(state: AudioState): AudioView {
  switch (state.kind) {
    case "broken":
      return { kind: "broken" };
    case "idle":
      return { kind: "player", button: "listen", busy: false, time: null };
    case "loading":
      return { kind: "player", button: "listen", busy: true, time: null };
    case "playing":
    case "paused":
      return {
        kind: "player",
        button: state.kind === "playing" ? "stop" : "listen",
        busy: false,
        time: Number.isFinite(state.duration)
          ? `${minSec(state.current)} / ${minSec(state.duration)}`
          : minSec(state.current),
      };
    case "ended":
      return {
        kind: "player",
        button: "listen",
        busy: false,
        time: minSec(state.duration),
      };
  }
}

/** The part of `HTMLAudioElement` the player uses. */
export type AudioLike = {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly error: { code: number } | null;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
};

/**
 * A silent WAV of a few samples: played inside the press, before any
 * `await`, so Safari lets the same element play the file after the
 * download (decision 6 of the brief).
 */
export const SILENT_AUDIO =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

/** `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED`. */
const SRC_NOT_SUPPORTED = 4;

export type AudioPlayerDeps = {
  /** The page's one element, made at the first press and kept. */
  createAudio: () => AudioLike;
  /** The voice note's file: the page's media store (`MediaStore.load`). */
  load: (mediaId: string) => Promise<MediaEntry>;
  /** Whether its downloads gave up (3 failures). */
  gaveUp: (mediaId: string) => boolean;
};

export type AudioPlayer = {
  /** «استمع» or «أوقف» on `mediaId`; `listen` is that voice note's reducer. */
  press(mediaId: string, listen: (event: AudioEvent) => void): void;
  /** The page closed: it stops, and lets the file go. */
  dispose(): void;
};

export function createAudioPlayer(deps: AudioPlayerDeps): AudioPlayer {
  let audio: AudioLike | null = null;
  /** The voice note that has the player, and whose file is its source. */
  let owner: { id: string; listen: (e: AudioEvent) => void } | null = null;
  let sourceOf: string | null = null;
  /**
   * The file is playing — from its own `playing` event to its `pause`,
   * `ended` or failure. Not `paused`: the silent clip moves that too.
   */
  let playing = false;

  const tell = (event: AudioEvent) => owner?.listen(event);
  const at = (a: AudioLike) => ({
    current: a.currentTime,
    duration: a.duration,
  });

  function element(): AudioLike {
    if (audio) return audio;
    const a = deps.createAudio();
    // Only the file's own events: the silent clip says nothing.
    const real = () => sourceOf !== null && owner?.id === sourceOf;
    a.addEventListener("playing", () => {
      if (!real()) return;
      playing = true;
      tell({ type: "playing", ...at(a) });
    });
    a.addEventListener("timeupdate", () => {
      if (real()) tell({ type: "time", ...at(a) });
    });
    a.addEventListener("pause", () => {
      if (!real()) return;
      playing = false;
      tell({ type: "pause", ...at(a) });
    });
    a.addEventListener("ended", () => {
      if (!real()) return;
      playing = false;
      tell({ type: "ended", duration: a.duration });
    });
    a.addEventListener("error", () => {
      if (!real() || a.error?.code !== SRC_NOT_SUPPORTED) return;
      playing = false;
      tell({ type: "playFailed", name: "NotSupportedError" });
    });
    audio = a;
    return a;
  }

  function play(a: AudioLike) {
    a.play().catch((err: unknown) => {
      playing = false;
      tell({
        type: "playFailed",
        name: err instanceof Error ? err.name : "Error",
      });
    });
  }

  return {
    press(mediaId, listen) {
      const a = element();
      if (owner?.id === mediaId && sourceOf === mediaId && playing) {
        a.pause();
        return;
      }
      if (owner !== null && owner.id !== mediaId) {
        const was = owner;
        const where = sourceOf === was.id ? at(a) : { current: 0, duration: 0 };
        a.pause();
        playing = false;
        owner = null;
        was.listen({ type: "stopped", ...where });
      }
      owner = { id: mediaId, listen };
      if (sourceOf === mediaId) {
        play(a);
        return;
      }
      // Inside the press, before any await: the silent clip.
      sourceOf = null;
      a.src = SILENT_AUDIO;
      a.play().catch(() => undefined);
      listen({ type: "load" });
      void deps.load(mediaId).then((entry) => {
        if (owner?.id !== mediaId) return;
        if (entry.kind !== "ready") {
          listen({ type: "loadFailed", gaveUp: deps.gaveUp(mediaId) });
          return;
        }
        sourceOf = mediaId;
        a.src = entry.url;
        play(a);
      });
    },
    dispose() {
      owner = null;
      sourceOf = null;
      playing = false;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
    },
  };
}
