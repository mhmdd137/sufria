"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  DASHBOARD_MEDIA_UI_AR,
  DASHBOARD_MESSAGES_UI_AR,
  DASHBOARD_UI_AR,
} from "@sufria/shared";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { useMediaEntry } from "../hooks/use-media.ts";
import { audioReducer, audioView, type AudioPlayer } from "../lib/audio.ts";
import type { MediaShown } from "../lib/details.ts";
import { openPdf } from "../lib/pdf.ts";
import { IMAGE_FRAME_MAX, isCropped, type MediaStore } from "../lib/media.ts";
import styles from "./media-message.module.css";
import chat from "./conversation.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MESSAGES_UI_AR;
const A = DASHBOARD_MEDIA_UI_AR;

type Props = {
  media: MediaShown;
  caption: string | null;
  store: MediaStore;
  /** The page's one voice-note player. */
  player: AudioPlayer;
  /** The order's total with its currency, over the image in the viewer. */
  total: string;
};

/**
 * A customer's stored image, voice note or PDF in the conversation (brief
 * م-هـ-ب §5.1, §5.4, §5.5), inside the message's `<li>`.
 */
export function MediaMessage({ media, caption, store, player, total }: Props) {
  switch (media.kind) {
    case "image":
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
    case "audio":
      return (
        <AudioMessage
          id={media.id}
          label={media.label}
          fallback={media.fallback}
          caption={caption}
          player={player}
        />
      );
    case "pdf":
      return (
        <PdfMessage
          id={media.id}
          fileName={media.fileName}
          caption={caption}
          store={store}
        />
      );
  }
}

function Caption({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p className={styles.mediaCaption} dir="auto">
      {text}
    </p>
  );
}

/**
 * The voice note (§5.4): «استمع» — «أوقف» while it plays — and beside it
 * «رسالة صوتية», then the time in the numbers' font. Its file downloads on
 * the press alone (decision 1). It does not play: the bubble is its word.
 */
function AudioMessage({
  id,
  label,
  fallback,
  caption,
  player,
}: {
  id: string;
  label: string;
  fallback: string;
  caption: string | null;
  player: AudioPlayer;
}) {
  const [state, dispatch] = useReducer(audioReducer, { kind: "idle" });
  const view = audioView(state);
  if (view.kind === "broken")
    return (
      <div className={`${chat.bubble} ${chat.stack}`}>
        <p className={chat.word}>{fallback}</p>
        <Caption text={caption} />
      </div>
    );
  return (
    <div className={`${chat.bubble} ${styles.audio}`}>
      <button
        type="button"
        className={chat.lineButton}
        aria-busy={view.busy}
        onClick={() => {
          if (!view.busy) player.press(id, dispatch);
        }}
      >
        {view.button === "stop" ? A.stop : A.listen}
      </button>
      {view.time === null ? (
        <span className={styles.audioLabel}>{label}</span>
      ) : (
        <span className={`num ${styles.audioTime}`} dir="ltr">
          {view.time}
        </span>
      )}
      <Caption text={caption} />
    </div>
  );
}

/**
 * The PDF (§5.5): its own name on one line, cut with …; «افتح الملف» —
 * the file in a new tab, downloaded on the press alone — and, when that
 * failed, the step's own line under it.
 */
function PdfMessage({
  id,
  fileName,
  caption,
  store,
}: {
  id: string;
  fileName: string | null;
  caption: string | null;
  store: MediaStore;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function open() {
    if (busy) return;
    setFailed(false);
    setBusy(true);
    // The tab opens in this call, before its first await.
    void openPdf(
      {
        openTab: () => window.open("", "_blank"),
        load: () => store.load(id),
        createUrl: (blob) => URL.createObjectURL(blob),
        revokeUrl: (url) => URL.revokeObjectURL(url),
        download: (url, name) => {
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.click();
        },
        later: (run, ms) => void window.setTimeout(run, ms),
      },
      fileName,
    ).then((outcome) => {
      setBusy(false);
      setFailed(outcome === "failed");
    });
  }

  return (
    <div className={`${chat.bubble} ${styles.pdf}`}>
      {fileName !== null && (
        <bdi dir="ltr" className={styles.fileName}>
          {fileName}
        </bdi>
      )}
      <button
        type="button"
        className={chat.lineButton}
        aria-busy={busy}
        onClick={open}
      >
        {A.openFile}
      </button>
      {failed && (
        <p className={chat.resumeFailed} role="status">
          {T.errors.stepFailed}
        </p>
      )}
      <Caption text={caption} />
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
