"use client";

import { useSyncExternalStore } from "react";
import { SERVER_SOUND_STATE, sound, type SoundState } from "./sound-store.ts";

/** The sound's state, for the header's button and the strips. */
export function useSound(): SoundState {
  return useSyncExternalStore(
    sound.subscribe,
    sound.getSnapshot,
    () => SERVER_SOUND_STATE,
  );
}
