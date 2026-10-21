import { isAllowedMime, mimeBase, type MediaKind } from "@sufria/shared";

import { env } from "../config/env.js";
import {
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  type DownloadResult,
  type MediaDownloader,
} from "../notify/media-fetcher.js";

/**
 * A customer's media from Meta Cloud API — brief م-هـ-أ §7.3, the shape of
 * `MetaWhatsAppSender`. Two requests, both with the engine's token:
 *
 * 1. `GET {base}/{version}/{media id}?phone_number_id={the restaurant's}` →
 *    `{ url, mime_type, file_size }`, within WHATSAPP_SEND_TIMEOUT_MS.
 * 2. `GET {url}` → the file, within MEDIA_DOWNLOAD_TIMEOUT_MS, read in chunks
 *    and stopped as soon as the count passes the limit.
 *
 * Before the second: announced bigger than the limit → `too_large`, never
 * downloaded; a MIME type the kind may not store → `unsupported`. After it:
 * an HTML page is a failure, never a file.
 *
 * 🔴 **Nothing of it is logged here** — not the URL Meta gives (it opens the
 *    file to whoever holds the token), not the token, not a byte; an error
 *    is told by its name alone. The queue logs the outcome, by our own id.
 *
 * 🔴 The URL is on Meta's other domain (`lookaside.fbsbx.com`): the host's
 *    network must let the engine reach it, not graph.facebook.com alone.
 */
export class MetaMediaDownloader implements MediaDownloader {
  constructor(
    private readonly accessToken: string = env().WHATSAPP_ACCESS_TOKEN,
    private readonly baseUrl: string = env().WHATSAPP_GRAPH_API_BASE,
    private readonly apiVersion: string = env().WHATSAPP_GRAPH_API_VERSION,
    private readonly infoTimeoutMs: number = env().WHATSAPP_SEND_TIMEOUT_MS,
    private readonly downloadTimeoutMs: number = MEDIA_DOWNLOAD_TIMEOUT_MS,
  ) {}

  async download(
    media: { waMediaId: string; phoneNumberId: string; kind: MediaKind },
    limitBytes: number,
  ): Promise<DownloadResult> {
    const auth = { authorization: `Bearer ${this.accessToken}` };

    // --- 1. Where the file is --------------------------------------------
    const infoUrl =
      `${this.baseUrl}/${this.apiVersion}/${encodeURIComponent(media.waMediaId)}` +
      `?phone_number_id=${encodeURIComponent(media.phoneNumberId)}`;
    let info: Response;
    try {
      info = await fetch(infoUrl, {
        headers: auth,
        signal: AbortSignal.timeout(this.infoTimeoutMs),
      });
    } catch (error) {
      return failed(`info request: ${errorName(error)}`, null);
    }
    if (!info.ok) {
      await info.body?.cancel().catch(() => undefined);
      return failed("info request refused", info.status);
    }
    const body = (await info.json().catch(() => null)) as {
      url?: unknown;
      mime_type?: unknown;
      file_size?: unknown;
    } | null;
    const url = body?.url;
    if (typeof url !== "string" || url === "")
      return failed("info without a url", info.status);
    const announced =
      typeof body?.file_size === "number" ? body.file_size : null;
    if (announced !== null && announced > limitBytes)
      return { kind: "too_large", sizeBytes: announced };
    const mimeType = typeof body?.mime_type === "string" ? body.mime_type : "";
    if (!isAllowedMime(media.kind, mimeType))
      return { kind: "unsupported", mimeType: mimeBase(mimeType) };

    // --- 2. The file ---------------------------------------------------------
    let file: Response;
    try {
      file = await fetch(url, {
        headers: auth,
        signal: AbortSignal.timeout(this.downloadTimeoutMs),
      });
    } catch (error) {
      return failed(`file request: ${errorName(error)}`, null);
    }
    if (!file.ok) {
      await file.body?.cancel().catch(() => undefined);
      return failed("file request refused", file.status);
    }
    // A page, not a file: an error or login page can answer 200 too.
    if (mimeBase(file.headers.get("content-type") ?? "") === "text/html") {
      await file.body?.cancel().catch(() => undefined);
      return failed("an HTML page instead of the file", file.status);
    }
    if (file.body === null) return failed("no body", file.status);

    const chunks: Uint8Array[] = [];
    let count = 0;
    const reader = file.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.length;
        // 🔴 Stopped here, not after: Meta may say 1 KB and send more.
        if (count > limitBytes) {
          await reader.cancel().catch(() => undefined);
          return { kind: "too_large", sizeBytes: count };
        }
        chunks.push(value);
      }
    } catch (error) {
      return failed(`reading the file: ${errorName(error)}`, file.status);
    }
    if (count === 0) return failed("an empty file", file.status);

    const bytes = new Uint8Array(count);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { kind: "stored", bytes };
  }
}

const failed = (reason: string, httpStatus: number | null): DownloadResult => ({
  kind: "failed",
  reason,
  httpStatus,
});

/** The error's name alone (`TimeoutError`, `TypeError`): never its message, which may carry the URL. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
