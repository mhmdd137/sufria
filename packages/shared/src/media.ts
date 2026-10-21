/**
 * A customer's media — brief م-هـ-أ §4.4 (Mohammed's decisions 1 and 2, 20
 * October 2026): an image, a voice note or audio file, or a PDF, kept by the
 * engine in `inbound_media` (0021). Pure functions: what a WhatsApp message
 * holds, what may be stored, and an image's size from its first bytes.
 *
 * The engine alone reads this module; the dashboard reads the contract types
 * in `dashboard-api.ts`.
 */
import type { MediaKind } from "./dashboard-api.js";

/**
 * The most a file may weigh: 5 MiB, Meta's own limit for an image. Bigger is
 * `too_large`, never downloaded. 0021 holds the same number in a CHECK, and a
 * test reads it there.
 */
export const MEDIA_MAX_BYTES = 5242880;

/** The media a WhatsApp message carries, as `inbound_media` keeps it. */
export interface MessageMedia {
  readonly kind: MediaKind;
  /** Meta's media id: downloadable for 7 days. */
  readonly waMediaId: string;
  /** As Meta sent it: `"audio/ogg; codecs=opus"`, never rewritten. */
  readonly mimeType: string;
  /** A PDF's own filename, as the customer's phone sent it. */
  readonly fileName: string | null;
}

/**
 * A MIME type's base: before `;`, no spaces, lower case —
 * `"Audio/OGG; codecs=opus"` → `"audio/ogg"`.
 */
export function mimeBase(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").replace(/\s+/gu, "").toLowerCase();
}

/**
 * What may be stored, by kind (§4.4) — checked again on Meta's answer when
 * the file is downloaded. A WhatsApp voice note is `audio/ogg`.
 */
export const MEDIA_ALLOWED_MIME: Record<MediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png"],
  audio: ["audio/ogg", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr"],
  pdf: ["application/pdf"],
};

/** `mimeType`'s base is one `kind` may store. */
export function isAllowedMime(kind: MediaKind, mimeType: string): boolean {
  return MEDIA_ALLOWED_MIME[kind].includes(mimeBase(mimeType));
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * The media of a WhatsApp message, from its type and the message object as
 * Meta sent it (`inbound_messages.payload`), or `null` — §4.4's table:
 *
 * - `image` with `image.id` and `image.mime_type` → `image`
 * - `audio` with `audio.id` and `audio.mime_type` → `audio`
 * - `document` whose base is `application/pdf` → `pdf`, with its filename
 * - `document` whose base is `image/jpeg` or `image/png` → `image` (a
 *   screenshot sent as a file)
 * - anything else — a video, a sticker, another document, a missing id or
 *   MIME type → `null`
 */
export function mediaFromMessage(
  type: string,
  payload: unknown,
): MessageMedia | null {
  if (!isObject(payload)) return null;
  const part = payload[type];
  if (!isObject(part) || !nonEmpty(part["id"]) || !nonEmpty(part["mime_type"]))
    return null;
  const waMediaId = part["id"];
  const mimeType = part["mime_type"];

  switch (type) {
    case "image":
    case "audio":
      return { kind: type, waMediaId, mimeType, fileName: null };
    case "document": {
      const base = mimeBase(mimeType);
      if (base === "application/pdf") {
        const name = part["filename"];
        return {
          kind: "pdf",
          waMediaId,
          mimeType,
          fileName: nonEmpty(name) ? name : null,
        };
      }
      if (isAllowedMime("image", base))
        return { kind: "image", waMediaId, mimeType, fileName: null };
      return null;
    }
    default:
      return null;
  }
}

/** An image's size in pixels. */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A JPEG's start-of-frame markers — the ones that carry its size. Not
 * `C4` (DHT), `C8` (JPG) or `CC` (DAC), which share the range.
 */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * An image's width and height from its header: PNG's `IHDR`, or a JPEG's
 * first start-of-frame. `null` for anything else, or a header cut short or
 * broken — the screen then keeps no place for it, and nothing fails.
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const at = (i: number): number => bytes[i] ?? -1;
  const u16 = (i: number): number =>
    i + 1 < bytes.length ? (at(i) << 8) | at(i + 1) : -1;
  const u32 = (i: number): number =>
    i + 3 < bytes.length
      ? ((at(i) << 24) >>> 0) +
        ((at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3))
      : -1;
  const sized = (width: number, height: number): ImageDimensions | null =>
    width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff
      ? { width, height }
      : null;

  // PNG: the signature, then IHDR's length, its name, width and height.
  if (PNG_SIGNATURE.every((b, i) => at(i) === b)) {
    const ihdr = [0x49, 0x48, 0x44, 0x52].every((b, i) => at(12 + i) === b);
    return ihdr ? sized(u32(16), u32(20)) : null;
  }

  // JPEG: SOI, then segments — a marker, its length, its data — up to SOS.
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length) {
    if (at(i) !== 0xff) return null;
    // Fill bytes: any number of 0xFF before a marker.
    while (at(i) === 0xff) i += 1;
    const marker = at(i);
    i += 1;
    if (marker < 0) return null;
    // Markers with no length: TEM and RST0–7.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // EOI or SOS before any frame: no size to read.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16(i);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      // Length, precision, then height and width.
      if (length < 7) return null;
      return sized(u16(i + 5), u16(i + 3));
    }
    i += length;
  }
  return null;
}
