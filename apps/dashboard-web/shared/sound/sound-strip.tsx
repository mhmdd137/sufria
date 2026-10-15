"use client";

import { DASHBOARD_SOUND_UI_AR } from "@sufria/shared";
import { sound, soundStrip } from "./sound-store.ts";
import { useSound } from "./use-sound.ts";
import styles from "./sound-strip.module.css";

const S = DASHBOARD_SOUND_UI_AR;

/**
 * Under the header on every page (brief م-ب, decision 9), where the pause
 * strip is and as strong — not amber: amber means orders are paused. While
 * the sound is muted on this device, or a sound was due and the browser kept
 * it stopped; «مكتوم» alone when both. «شغّل الصوت» right after the text.
 * Under the pause strip when both show (the layout's order).
 */
export function SoundStrip() {
  const state = useSound();
  const strip = soundStrip(state);
  if (strip === null) return null;

  return (
    <div className={styles.strip} data-strip={strip} role="status">
      <div className={styles.bounds}>
        <span className={styles.label}>
          {strip === "muted" ? S.muted : S.blocked}
        </span>
        <button
          type="button"
          className={styles.on}
          onClick={() => void sound.enable()}
        >
          {S.unmute}
        </button>
      </div>
    </div>
  );
}
