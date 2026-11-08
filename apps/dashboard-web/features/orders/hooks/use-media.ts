"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ordersApi } from "../api/orders-api.ts";
import { createAudioPlayer, type AudioPlayer } from "../lib/audio.ts";
import {
  createMediaStore,
  type MediaEntry,
  type MediaStore,
} from "../lib/media.ts";

/**
 * The order page's media (brief م-هـ-ب §6): one store for the page's life —
 * each file downloaded once, whatever the 5 s reads do — and every `blob:`
 * URL revoked when the page closes.
 */
export function useMediaStore(
  orderId: string,
  reportOffline: (offline: boolean) => void,
): MediaStore {
  const [store] = useState(() =>
    createMediaStore({
      fetch: (mediaId) => ordersApi.media(orderId, mediaId),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
      reportOffline,
    }),
  );
  useEffect(() => () => store.dispose(), [store]);
  return store;
}

const IDLE: MediaEntry = { kind: "idle" };

/** One media's entry, rendered again whenever it changes. */
export function useMediaEntry(store: MediaStore, mediaId: string): MediaEntry {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(mediaId),
    () => IDLE,
  );
}

/**
 * The page's one voice-note player (brief م-هـ-ب, decisions 6 and 7 of the
 * brief): one `Audio`, made at the first press — a second voice note stops
 * the first — stopped when the page closes.
 */
export function useAudioPlayer(store: MediaStore): AudioPlayer {
  const [player] = useState(() =>
    createAudioPlayer({
      createAudio: () => new Audio(),
      load: (mediaId) => store.load(mediaId),
      gaveUp: (mediaId) => store.gaveUp(mediaId),
    }),
  );
  useEffect(() => () => player.dispose(), [player]);
  return player;
}
