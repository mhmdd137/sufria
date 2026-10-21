import { sql } from "drizzle-orm";
import {
  MEDIA_MAX_BYTES,
  imageDimensions,
  isAllowedMime,
  type MediaKind,
} from "@sufria/shared";

import type { TenantDb } from "../db/tenant-db.js";
import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";

/**
 * The media queue — brief م-هـ-أ §7 (Mohammed's decision 1, 20 October
 * 2026): a customer's image, voice note or PDF, downloaded from Meta as soon
 * as it arrives and kept in `inbound_media` (0021). Meta keeps a webhook's
 * media for 7 days, and its token stays with the engine alone.
 *
 * The webhook writes a `pending` row for a message relayed to an order
 * (`whatsapp/webhook.service.ts`, step 6); here, every MEDIA_POLL_MS, the
 * rows due are claimed, downloaded and finished. The shape of
 * `StaffReplySender` (brief م-ج), with one difference — a download is
 * harmless twice, a send is not:
 *
 * 🔴 **The claim is a lease, not a state.** One statement counts the attempt
 *    and moves `next_attempt_at` MEDIA_LEASE_SECONDS ahead, `FOR UPDATE SKIP
 *    LOCKED`: two cycles never take one row. A process that dies mid-download
 *    leaves the row `pending`, due again once the lease ends.
 *
 * 🔴 **No transaction is open while a file comes down** (Gaza's network):
 *    the claim commits first, and the result is written in a transaction of
 *    its own — **guarded by the attempt it claimed**. A worker back after
 *    its lease ended, once another claimed the row, writes zero rows: never
 *    over the other's.
 *
 * 🔴 **No log line carries** the token, Meta's URL, the file's bytes or the
 *    customer's caption — our media id, the restaurant, the kind, the size,
 *    the outcome and the attempt, and nothing else.
 *
 * Access: no inbound message, so no tenant context, and `sufria_engine`
 * sees zero rows without one. `app.restaurants_with_pending_media()` (0021,
 * Bypass #6) returns restaurant ids and nothing else; every read and write
 * after it is inside `runInTenant`.
 */

/** Rows per restaurant per cycle, due first. */
export const MEDIA_BATCH_SIZE = 10;

/**
 * The lease a claim takes. More than the longest a download can take — the
 * info request (WHATSAPP_SEND_TIMEOUT_MS, 10 s by default) and the file
 * (MEDIA_DOWNLOAD_TIMEOUT_MS) — with room to spare: a test holds them.
 */
export const MEDIA_LEASE_SECONDS = 120;

/** The file's own request: 60 s, then a failure, retried later. */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * The wait after a failed attempt, by its number: 30 s, 2 min, 10 min, an
 * hour, 6 hours. The sixth failure is final.
 */
export const MEDIA_RETRY_DELAYS_SECONDS: readonly number[] = [
  30, 120, 600, 3600, 21600,
];

/** Meta keeps a webhook's media this long; older is `failed`, never asked. */
export const MEDIA_MAX_AGE_DAYS = 7;

/** What a download came to — `MediaDownloader`'s answer. */
export type DownloadResult =
  | { kind: "stored"; bytes: Uint8Array }
  /** Over the limit: Meta's announced size, or the count when it stopped. */
  | { kind: "too_large"; sizeBytes: number }
  /** Meta's MIME type is not one the kind may store. Final. */
  | { kind: "unsupported"; mimeType: string }
  /** Anything else: a timeout, a 4xx or 5xx, an HTML page. Retried. */
  | { kind: "failed"; reason: string; httpStatus: number | null };

/**
 * Meta's media behind an interface for one reason: **the tests never call
 * Meta**. `MetaMediaDownloader` (`whatsapp/media-downloader.ts`) is the real
 * one, tried against a local `node:http` server.
 */
export interface MediaDownloader {
  download(
    media: { waMediaId: string; phoneNumberId: string; kind: MediaKind },
    limitBytes: number,
  ): Promise<DownloadResult>;
}

export type MediaOutcome =
  | "stored"
  | "too_large"
  | "unsupported"
  /** A failure with attempts left: due again after its delay. */
  | "retry"
  /** The sixth failure. */
  | "failed"
  /** Older than MEDIA_MAX_AGE_DAYS: failed, Meta never asked. */
  | "expired"
  | "no_sender_number"
  /** The result found the row claimed again since: nothing written. */
  | "stale"
  | "error";

export interface MediaTickResult {
  /** `true` = a cycle was still running in this process: this one skipped. */
  skipped: boolean;
  outcomes: { mediaId: string; outcome: MediaOutcome }[];
}

/** What the queue uses from pino. Injected so a test can read the lines. */
export interface MediaLog {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface MediaFetcherOptions {
  /** `0` (the default) = no timer. `main.ts` passes MEDIA_POLL_MS. */
  pollMs?: number;
  batchSize?: number;
  log?: MediaLog;
  /**
   * 🔴 **Tests alone.** Confines the cycle to these restaurants: the other
   *    suites run alongside under `pnpm -r test`.
   */
  restaurantScope?: readonly string[];
  /**
   * 🔴 **Tests alone.** Called between the listing and the claim, outside
   *    any transaction — the one place two cycles race.
   */
  beforeClaim?: (restaurantId: string) => Promise<void>;
}

/** A row as the claim returned it — the download's only source. */
export interface ClaimedMedia {
  id: string;
  restaurantId: string;
  waMediaId: string;
  kind: MediaKind;
  /** As the webhook carried it — what the dashboard serves it as. */
  mimeType: string;
  /** After this claim: 1 on the first. The result's guard. */
  attempts: number;
  /** Older than MEDIA_MAX_AGE_DAYS, by the database's clock. */
  tooOld: boolean;
  /** `restaurants.whatsapp_phone_id`, for Meta's `phone_number_id`. */
  phoneNumberId: string | null;
}

type Finish =
  | {
      state: "stored";
      bytes: Uint8Array;
      width: number | null;
      height: number | null;
    }
  | { state: "too_large"; sizeBytes: number }
  | { state: "failed" }
  | { state: "retry"; delaySeconds: number };

export class MediaFetcher {
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly log: MediaLog;
  private readonly scope: ReadonlySet<string> | null;
  private readonly beforeClaim:
    ((restaurantId: string) => Promise<void>) | null;

  private timer: NodeJS.Timeout | null = null;
  /** The running cycle: the next one skips, and `stop()` waits for it. */
  private current: Promise<MediaTickResult> | null = null;

  constructor(
    private readonly db: TenantDb,
    private readonly downloader: MediaDownloader,
    options: MediaFetcherOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 0;
    this.batchSize = options.batchSize ?? MEDIA_BATCH_SIZE;
    this.log = options.log ?? logger;
    this.scope = options.restaurantScope
      ? new Set(options.restaurantScope)
      : null;
    this.beforeClaim = options.beforeClaim ?? null;
  }

  /** Starts the timer. `pollMs = 0` → nothing. */
  start(): void {
    if (this.pollMs === 0 || this.timer !== null) return;
    this.timer = setInterval(() => {
      // tick() catches each row on its own; this is for what is above.
      this.tick().catch((error: unknown) => {
        this.log.error({ err: error }, "🔴 media cycle failed");
      });
    }, this.pollMs);
  }

  /** Stops the timer and waits for the running cycle, so the pool is not closed under it. */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.current !== null) await this.current.catch(() => undefined);
  }

  /** One cycle. Never two at once in one process; between processes, the lease. */
  async tick(): Promise<MediaTickResult> {
    if (this.current !== null) return { skipped: true, outcomes: [] };
    this.current = this.runCycle().then((outcomes) => ({
      skipped: false,
      outcomes,
    }));
    try {
      return await this.current;
    } finally {
      this.current = null;
    }
  }

  private async runCycle(): Promise<MediaTickResult["outcomes"]> {
    const restaurantIds = await this.db.runUnscoped(async (tx) => {
      const res = await tx.execute<{ id: string }>(
        sql`SELECT r AS id FROM app.restaurants_with_pending_media() r`,
      );
      return res.rows.map((row) => row.id);
    });

    const outcomes: MediaTickResult["outcomes"] = [];
    for (const restaurantId of restaurantIds) {
      if (this.scope !== null && !this.scope.has(restaurantId)) continue;
      let claimed: ClaimedMedia[];
      try {
        if (this.beforeClaim !== null) await this.beforeClaim(restaurantId);
        // 🔴 Committed before any download.
        claimed = await this.db.runInTenant(restaurantId, (tx) =>
          claimMedia(tx, this.batchSize),
        );
      } catch (error) {
        // One restaurant does not stop the others.
        this.log.error(
          { err: error, restaurantId },
          "🔴 claiming a restaurant's media failed",
        );
        continue;
      }
      for (const media of claimed) {
        let outcome: MediaOutcome;
        try {
          outcome = await this.fetchOne(media);
        } catch (error) {
          // 🔴 One file does not stop the cycle. The row stays `pending`,
          //    due again when its lease ends.
          this.log.error(
            {
              err: error,
              mediaId: media.id,
              restaurantId,
              attempts: media.attempts,
            },
            "🔴 a media row failed in the queue",
          );
          outcome = "error";
        }
        outcomes.push({ mediaId: media.id, outcome });
      }
    }
    return outcomes;
  }

  private async fetchOne(media: ClaimedMedia): Promise<MediaOutcome> {
    const fields = {
      mediaId: media.id,
      restaurantId: media.restaurantId,
      kind: media.kind,
      attempts: media.attempts,
    };

    if (media.tooOld)
      return this.finish(media, fields, { state: "failed" }, "expired");
    if (!media.phoneNumberId) {
      this.log.error(
        fields,
        "🔴 the restaurant has no whatsapp_phone_id — media failed",
      );
      return this.finish(
        media,
        fields,
        { state: "failed" },
        "no_sender_number",
      );
    }
    // 🔴 The dashboard serves the file as the MIME type the webhook carried:
    //    one this kind may not store is never downloaded at all.
    if (!isAllowedMime(media.kind, media.mimeType))
      return this.finish(media, fields, { state: "failed" }, "unsupported");

    const result = await this.downloader.download(
      {
        waMediaId: media.waMediaId,
        phoneNumberId: media.phoneNumberId,
        kind: media.kind,
      },
      MEDIA_MAX_BYTES,
    );

    switch (result.kind) {
      case "stored": {
        const size =
          media.kind === "image" ? imageDimensions(result.bytes) : null;
        return this.finish(
          media,
          { ...fields, sizeBytes: result.bytes.length },
          {
            state: "stored",
            bytes: result.bytes,
            width: size?.width ?? null,
            height: size?.height ?? null,
          },
          "stored",
        );
      }
      case "too_large":
        return this.finish(
          media,
          { ...fields, sizeBytes: result.sizeBytes },
          { state: "too_large", sizeBytes: result.sizeBytes },
          "too_large",
        );
      case "unsupported":
        return this.finish(
          media,
          { ...fields, mimeType: result.mimeType },
          { state: "failed" },
          "unsupported",
        );
      case "failed": {
        const delay = MEDIA_RETRY_DELAYS_SECONDS[media.attempts - 1];
        const why = { reason: result.reason, httpStatus: result.httpStatus };
        if (delay === undefined)
          return this.finish(
            media,
            { ...fields, ...why },
            { state: "failed" },
            "failed",
          );
        return this.finish(
          media,
          { ...fields, ...why, retryInSeconds: delay },
          { state: "retry", delaySeconds: delay },
          "retry",
        );
      }
      default: {
        const unreachable: never = result;
        throw new Error(`unknown download result: ${String(unreachable)}`);
      }
    }
  }

  /**
   * The result, in a transaction of its own, from the attempt this worker
   * claimed alone (`AND attempts = …`). Zero rows: claimed again since —
   * `stale`, and nothing written.
   */
  private async finish(
    media: ClaimedMedia,
    fields: object,
    end: Finish,
    outcome: MediaOutcome,
  ): Promise<MediaOutcome> {
    const sets =
      end.state === "stored"
        ? sql`state = 'stored', content = ${Buffer.from(end.bytes)}::bytea,
              size_bytes = ${end.bytes.length}, width = ${end.width},
              height = ${end.height}, finished_at = now()`
        : end.state === "too_large"
          ? sql`state = 'too_large', size_bytes = ${end.sizeBytes},
                finished_at = now()`
          : end.state === "failed"
            ? sql`state = 'failed', finished_at = now()`
            : sql`next_attempt_at = now() + make_interval(secs => ${end.delaySeconds})`;
    const res = await this.db.runInTenant(media.restaurantId, (tx) =>
      tx.execute<{ id: string }>(sql`
        UPDATE inbound_media
           SET ${sets}
         WHERE id = ${media.id}::uuid
           AND state = 'pending'
           AND attempts = ${media.attempts}
        RETURNING id`),
    );
    if (res.rows.length === 0) {
      this.log.warn(
        { ...fields, outcome },
        "media claimed again since this attempt — its result not written",
      );
      return "stale";
    }
    const line = { ...fields, outcome };
    if (outcome === "stored" || outcome === "retry")
      this.log.info(line, "media done");
    else this.log.warn(line, "media done");
    return outcome;
  }
}

/**
 * 🔴 The claim — brief م-هـ-أ §7.2, tried on Postgres as the engine's role:
 * the lease and the attempt in one statement, the rows due first, `SKIP
 * LOCKED`, so two cycles never take one row and neither waits on the other.
 * Inside `runInTenant`: RLS confines it to the context's restaurant.
 */
export async function claimMedia(
  tx: TenantTx,
  batchSize: number,
): Promise<ClaimedMedia[]> {
  const res = await tx.execute<{
    id: string;
    restaurant_id: string;
    wa_media_id: string;
    kind: MediaKind;
    mime_type: string;
    attempts: number;
    too_old: boolean;
    whatsapp_phone_id: string | null;
  }>(sql`
    UPDATE inbound_media m
       SET attempts = m.attempts + 1,
           next_attempt_at = now() + make_interval(secs => ${MEDIA_LEASE_SECONDS})
      FROM restaurants r
     WHERE m.id IN (SELECT id FROM inbound_media
                     WHERE state = 'pending' AND next_attempt_at <= now()
                     ORDER BY next_attempt_at, id
                     LIMIT ${batchSize}
                     FOR UPDATE SKIP LOCKED)
       AND r.id = m.restaurant_id
    RETURNING m.id, m.restaurant_id, m.wa_media_id, m.kind, m.mime_type,
              m.attempts,
              m.created_at < now() - make_interval(days => ${MEDIA_MAX_AGE_DAYS})
                AS too_old,
              r.whatsapp_phone_id`);
  return res.rows.map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    waMediaId: row.wa_media_id,
    kind: row.kind,
    mimeType: row.mime_type,
    attempts: row.attempts,
    tooOld: row.too_old,
    phoneNumberId: row.whatsapp_phone_id,
  }));
}
