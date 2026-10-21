import type { OrderMediaFile } from "./orders.service.js";

/**
 * A customer's file in the browser — brief م-هـ-أ §8.4. What the customer
 * sent is served as data, never a page: its own MIME type and nothing
 * sniffed, no script, a sandbox. Private to the staff member's browser for
 * a day — the bytes never change.
 */
export function mediaHeaders(file: OrderMediaFile): Record<string, string> {
  return {
    "Content-Type": file.mimeType,
    "Content-Length": String(file.content.length),
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": contentDisposition(file),
  };
}

/**
 * `inline` for an image and a voice note. A PDF is `inline` too, with an
 * English name of ours, `order-<number>.pdf`, and the customer's own after
 * it as `filename*` — cleaned of `/`, `\`, `"` and every control character,
 * so it can neither leave the header nor name a path.
 */
export function contentDisposition(file: OrderMediaFile): string {
  if (file.kind !== "pdf") return "inline";
  const ours = `inline; filename="order-${file.orderNumber}.pdf"`;
  const theirs = cleanFileName(file.fileName);
  return theirs === null
    ? ours
    : `${ours}; filename*=UTF-8''${encodeRfc5987(theirs)}`;
}

/** The customer's filename without what a header or a path could misread; `null` when nothing is left. */
export function cleanFileName(name: string | null): string | null {
  if (name === null) return null;
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[/\\"\u0000-\u001F\u007F-\u009F]/gu, "").trim();
  return clean === "" ? null : clean;
}

/** RFC 5987's value: percent-encoded UTF-8, `'()*` included. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
