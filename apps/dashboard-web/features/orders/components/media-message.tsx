"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DASHBOARD_MESSAGES_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { useMediaEntry } from "../hooks/use-media.ts";
import type { MediaShown } from "../lib/details.ts";
import { IMAGE_FRAME_MAX, isCropped, type MediaStore } from "../lib/media.ts";
import styles from "./media-message.module.css";
import chat from "./conversation.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MESSAGES_UI_AR;

type Props = {
  media: MediaShown;
  caption: string | null;
  store: MediaStore;
  /** The order's total with its currency, over the image in the viewer. */
  total: string;
};

/**
 * A customer's stored image, voice note or PDF in the conversation (brief
 * م-هـ-ب §5.1, §5.4, §5.5), inside the message's `<li>`.
 */
export function MediaMessage({ media, caption, store, total }: Props) {
  if (media.kind === "image")
    return (
      <ImageMessage
        id={media.id}
        width={media.width}
        height={media.height}
        caption={caption}
        store={store}
        total={total}
      />
    );
  // The player and the PDF's row: mhb-7.
  return (
    <div className={`${chat.bubble} ${chat.stack}`}>
      <p className={chat.word}>{media.fallback}</p>
      {caption !== null && (
        <p className={chat.caption} dir="auto">
          {caption}
        </p>
      )}
    </div>
  );
}

/**
 * The image (§5.1): the conversation's width up to 360px, cut to 320px tall
 * from its middle — where a transfer's screenshot carries the amount and the
 * operation's code. Its frame has its final height from the first read (the
 * API's size; 320 without one), empty until the file arrives, so the list
 * does not move under the staff member. A press opens the viewer; «عرض
 * الكل» under it, only when something is cut.
 */
function ImageMessage({
  id,
  width,
  height,
  caption,
  store,
  total,
}: {
  id: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  store: MediaStore;
  total: string;
}) {
  const entry = useMediaEntry(store, id);
  // The image's own size once it loaded: the header's can be turned (its
  // rotation tag) — then the frame jumps once (a known gap).
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [cropped, setCropped] = useState(false);
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const ratio =
    natural !== null
      ? `${natural.w} / ${natural.h}`
      : width !== null && height !== null && width > 0 && height > 0
        ? `${width} / ${height}`
        : null;

  const measure = useCallback(() => {
    const box = frame.current;
    if (!box || natural === null) return;
    setCropped(
      isCropped(natural.w, natural.h, box.clientWidth, box.clientHeight),
    );
  }, [natural]);

  useEffect(() => {
    measure();
    if (natural === null) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, natural]);

  const url = entry.kind === "ready" ? entry.url : null;

  return (
    <>
      <div className={styles.imageBubble}>
        <div
          ref={frame}
          className={styles.frame}
          style={
            ratio !== null
              ? { aspectRatio: ratio }
              : { height: `${IMAGE_FRAME_MAX}px` }
          }
        >
          {url !== null && (
            <button
              type="button"
              className={styles.zoom}
              aria-label={M.kind.image}
              onClick={() => setOpen(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the customer's file, never Next's optimizer */}
              <img
                src={url}
                alt=""
                className={styles.image}
                onLoad={(e) =>
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
              />
            </button>
          )}
        </div>
        {caption !== null && (
          <p className={styles.imageCaption} dir="auto">
            {caption}
          </p>
        )}
      </div>
      {url !== null && cropped && (
        <button
          type="button"
          className={chat.more}
          onClick={() => setOpen(true)}
        >
          {T.conversation.showAll}
        </button>
      )}
      {url !== null && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          labelledBy={titleId}
          className={styles.viewer}
        >
          <h2 id={titleId} className="visually-hidden">
            {M.kind.image}
          </h2>
          <div className={styles.viewerHead}>
            <p className={styles.viewerTotal}>
              <span className={styles.viewerLabel}>{T.details.total}</span>
              <bdi className={`num ${styles.viewerAmount}`}>{total}</bdi>
            </p>
            <button
              type="button"
              className={styles.back}
              onClick={() => setOpen(false)}
            >
              {T.cancel.back}
            </button>
          </div>
          <div className={styles.viewerBody}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the same blob: URL, no second download */}
            <img src={url} alt="" className={styles.viewerImage} />
          </div>
        </Dialog>
      )}
    </>
  );
}
