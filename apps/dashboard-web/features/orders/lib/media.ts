/**
 * A customer's media on the order's page (brief م-هـ-ب), apart from React:
 * one download per media for the page's life, and what each message shows.
 *
 * The file is read with `fetch` and its headers — the token and the
 * restaurant (`ordersApi.media`) — into a `Blob`, then a `blob:` URL; never
 * an `<img src>` of the API's path, which would carry neither (decision 3
 * of the brief).
 */
import type { ApiError, ApiResult } from "../../../shared/api/http.ts";

/** Each image's attempts: with every read of the conversation, 3 at most. */
export const MEDIA_MAX_ATTEMPTS = 3;

/** One media's place in the page's store. */
export type MediaEntry =
  | { kind: "idle" }
  | { kind: "loading"; failures: number }
  | { kind: "ready"; blob: Blob; url: string }
  /** The last attempt failed; `failures` so far. */
  | { kind: "failed"; failures: number; error: ApiError };

export type MediaStoreDeps = {
  fetch: (mediaId: string) => Promise<ApiResult<Blob>>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  /** A network failure: the page's «انقطع الاتصال» strip. */
  reportOffline?: (offline: boolean) => void;
};

export type MediaStore = {
  /** The entry as the page renders it: one object per state, for React. */
  get(mediaId: string): MediaEntry;
  /**
   * The media's file: the download in flight, or the one done, is the same
   * promise (decision 4) — a second call, or the next read 5 s later, does
   * not download again. Once a download failed, a call tries again.
   */
  load(mediaId: string): Promise<MediaEntry>;
  /**
   * An image with every read (decision 5): download it if it is not there,
   * or try again after a failure — 3 attempts at most, then it stays failed
   * until the page opens again.
   */
  ensure(mediaId: string): void;
  /** Whether a media gave up: 3 failed attempts (`MEDIA_MAX_ATTEMPTS`). */
  gaveUp(mediaId: string): boolean;
  subscribe(listener: () => void): () => void;
  /** The page closed: every URL revoked, nothing downloaded after. */
  dispose(): void;
};

const IDLE: MediaEntry = { kind: "idle" };

export function createMediaStore(deps: MediaStoreDeps): MediaStore {
  const entries = new Map<string, MediaEntry>();
  const inFlight = new Map<string, Promise<MediaEntry>>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const set = (mediaId: string, entry: MediaEntry) => {
    entries.set(mediaId, entry);
    for (const l of listeners) l();
  };
  const failures = (e: MediaEntry) =>
    e.kind === "failed" || e.kind === "loading" ? e.failures : 0;

  function load(mediaId: string): Promise<MediaEntry> {
    const current = entries.get(mediaId) ?? IDLE;
    if (current.kind === "ready") return Promise.resolve(current);
    const pending = inFlight.get(mediaId);
    if (pending) return pending;
    const before = failures(current);
    set(mediaId, { kind: "loading", failures: before });
    const promise = deps.fetch(mediaId).then((res): MediaEntry => {
      inFlight.delete(mediaId);
      if (disposed) return IDLE;
      if (res.ok) {
        deps.reportOffline?.(false);
        const entry: MediaEntry = {
          kind: "ready",
          blob: res.value,
          url: deps.createUrl(res.value),
        };
        set(mediaId, entry);
        return entry;
      }
      if (res.error.kind === "network") deps.reportOffline?.(true);
      const entry: MediaEntry = {
        kind: "failed",
        failures: before + 1,
        error: res.error,
      };
      set(mediaId, entry);
      return entry;
    });
    inFlight.set(mediaId, promise);
    return promise;
  }

  const gaveUp = (mediaId: string) => {
    const e = entries.get(mediaId) ?? IDLE;
    return e.kind === "failed" && e.failures >= MEDIA_MAX_ATTEMPTS;
  };

  return {
    get: (mediaId) => entries.get(mediaId) ?? IDLE,
    load,
    ensure(mediaId) {
      if (disposed || gaveUp(mediaId)) return;
      const e = entries.get(mediaId) ?? IDLE;
      if (e.kind === "idle" || e.kind === "failed") void load(mediaId);
    },
    gaveUp,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const e of entries.values())
        if (e.kind === "ready") deps.revokeUrl(e.url);
      entries.clear();
      listeners.clear();
    },
  };
}
