/**
 * «افتح الملف» — a customer's PDF in a new tab (brief م-هـ-ب §5.5, decision
 * 8 of the brief), apart from React.
 */
import type { MediaEntry } from "./media.ts";

/** The new tab, revoked this long after it was given the file. */
export const PDF_URL_LIFETIME_MS = 60_000;

/** The part of the tab `window.open` returns that this uses. */
export type TabLike = {
  opener: unknown;
  location: { href: string };
  close(): void;
};

export type OpenPdfDeps = {
  /** `window.open("", "_blank")`: `null` when the browser refused it. */
  openTab: () => TabLike | null;
  /** The file: the page's media store (`MediaStore.load`). */
  load: () => Promise<MediaEntry>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  /** No tab: a link with `download`, pressed. */
  download: (url: string, fileName: string) => void;
  later: (run: () => void, ms: number) => void;
};

/**
 * The tab is opened inside the press, before any `await` — Safari blocks a
 * tab opened after the download — and cut from this page at once
 * (`opener = null`). 🔴 The file goes to it as a new `Blob` of type
 * `application/pdf`, whatever the response said: a `blob:` URL is of the
 * dashboard's own origin, and a file that is not a PDF, shown as HTML,
 * could reach the token in `sessionStorage`.
 *
 * `failed`: the tab is closed again, and the row says «لا يمكن تنفيذ هذه
 * الخطوة الآن.».
 */
export async function openPdf(
  deps: OpenPdfDeps,
  fileName: string | null,
): Promise<"opened" | "downloaded" | "failed"> {
  const tab = deps.openTab();
  if (tab) tab.opener = null;
  const entry = await deps.load();
  if (entry.kind !== "ready") {
    tab?.close();
    return "failed";
  }
  const url = deps.createUrl(
    new Blob([entry.blob], { type: "application/pdf" }),
  );
  // The tab still reads it for a while: not revoked at once.
  deps.later(() => deps.revokeUrl(url), PDF_URL_LIFETIME_MS);
  if (tab) {
    tab.location.href = url;
    return "opened";
  }
  deps.download(url, fileName ?? "");
  return "downloaded";
}
