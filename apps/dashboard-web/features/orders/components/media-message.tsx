"use client";

import type { MediaStore } from "../lib/media.ts";
import type { MediaShown } from "../lib/details.ts";
import styles from "./conversation.module.css";

type Props = {
  media: MediaShown;
  caption: string | null;
  store: MediaStore;
};

/**
 * A customer's stored image, voice note or PDF in the conversation (brief
 * م-هـ-ب §5.1, §5.4, §5.5). Until the image, the player and the PDF's row
 * are built (mhb-6, mhb-7), the word as before.
 */
export function MediaMessage({ media, caption }: Props) {
  return (
    <div className={`${styles.bubble} ${styles.stack}`}>
      <p className={styles.word}>{media.fallback}</p>
      {caption !== null && (
        <p className={styles.caption} dir="auto">
          {caption}
        </p>
      )}
    </div>
  );
}
