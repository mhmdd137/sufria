/**
 * mha-5 · a customer's media — brief م-هـ-أ §7, on a real database.
 *
 * Three parts. The webhook writes a `pending` row for a message relayed to
 * an order, and none otherwise (§7.1). The queue claims, downloads through a
 * downloader of this file's own and finishes each row (§7.2). And
 * `MetaMediaDownloader` itself, against a local `node:http` server standing
 * in for Graph API (§7.3) — 🔴 **no request ever reaches Meta**: the token
 *    and the base URL are this file's, never the environment's.
 *
 * Every test builds its restaurant through the audit connection above RLS
 * and reads the rows back from there; every queue is confined to its test's
 * restaurants (`restaurantScope`).
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import type { MediaKind } from "@sufria/shared";

import { parseEnv } from "../src/config/env.js";
import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import {
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  MEDIA_LEASE_SECONDS,
  MediaFetcher,
  type DownloadResult,
  type MediaDownloader,
  type MediaFetcherOptions,
  type MediaLog,
} from "../src/notify/media-fetcher.js";
import { MetaMediaDownloader } from "../src/whatsapp/media-downloader.js";
import { parseWebhookPayload } from "../src/whatsapp/payload.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";
import { WebhookService } from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();

let db: TenantDb;
let audit: Pool;
let webhook: WebhookService;
const createdRestaurants: string[] = [];

let phoneSeq = 0;
const nextPhone = (): string => `96273${String(++phoneSeq).padStart(7, "0")}`;
let waSeq = 0;
const nextWamid = (): string => `wamid.MEDIA.${RUN}.${++waSeq}`;

/** A PNG's signature and IHDR, 1080×1920, then padding. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0x04, 0x38, 0, 0, 0x07, 0x80, 8, 6, 0, 0, 0, 1, 2, 3,
]);

interface Shop {
  id: string;
  pid: string | null;
}

async function shop(
  label: string,
  opts: { phoneNumberId?: string | null } = {},
): Promise<Shop> {
  const pid =
    opts.phoneNumberId === undefined
      ? `PHONE.MEDIA.${RUN}.${label}`
      : opts.phoneNumberId;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb)
     RETURNING id`,
    [`مطعم وسائط ${label} ${RUN}`, pid],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);
  return { id, pid };
}

let orderNumber = 101;

/** An order of `from` at `s`, `ageMinutes` old, `status` (on its way by default). */
async function order(
  s: Shop,
  from: string,
  spec: { status?: string; ageMinutes?: number } = {},
): Promise<string> {
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2)
     ON CONFLICT (restaurant_id, phone_number) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [s.id, from],
  );
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, notified,
                         subtotal, total, created_at, updated_at)
     VALUES ($1, $2, $3, 'pickup', 'transfer', $4::order_status, 'pending_transfer',
             true, 5.00, 5.00, now() - make_interval(mins => $5),
             now() - make_interval(mins => $5))
     RETURNING id`,
    [
      s.id,
      customer.rows[0]?.id,
      orderNumber++,
      spec.status ?? "accepted",
      spec.ageMinutes ?? 10,
    ],
  );
  return rows[0]?.id ?? "";
}

/** One message from `from` to `pid`, as Meta delivers it. */
function delivery(
  pid: string,
  from: string,
  message: Record<string, unknown>,
): NonNullable<ReturnType<typeof parseWebhookPayload>> {
  const parsed = parseWebhookPayload({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "970590000000",
                phone_number_id: pid,
              },
              messages: [
                { from, id: nextWamid(), timestamp: "1757000000", ...message },
              ],
            },
          },
        ],
      },
    ],
  });
  if (parsed === null) throw new Error("the payload did not parse");
  return parsed;
}

interface MediaRow {
  id: string;
  kind: string;
  wa_media_id: string;
  mime_type: string;
  file_name: string | null;
  state: string;
  attempts: number;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  content: Buffer | null;
  due_in_seconds: number;
  finished: boolean;
}

async function mediaOf(s: Shop): Promise<MediaRow[]> {
  const { rows } = await audit.query<MediaRow>(
    `SELECT id, kind, wa_media_id, mime_type, file_name, state, attempts,
            size_bytes, width, height, content,
            extract(epoch from next_attempt_at - now())::float8 AS due_in_seconds,
            finished_at IS NOT NULL AS finished
       FROM inbound_media WHERE restaurant_id = $1 ORDER BY created_at, id`,
    [s.id],
  );
  return rows;
}

/** A `pending` media row at `s`, written as the webhook writes it, then aged. */
async function pendingMedia(
  s: Shop,
  spec: {
    kind?: MediaKind;
    mime?: string;
    ageDays?: number;
    attempts?: number;
  } = {},
): Promise<string> {
  const msg = await audit.query<{ id: string }>(
    `INSERT INTO inbound_messages (restaurant_id, wa_message_id, phone_number_id,
                                   from_phone, message_type, payload)
     VALUES ($1, $2, 'PHONE', $3, 'image', '{}'::jsonb) RETURNING id`,
    [s.id, nextWamid(), nextPhone()],
  );
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_media (restaurant_id, inbound_message_id, kind, wa_media_id,
                                mime_type, attempts, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(days => $7))
     RETURNING id`,
    [
      s.id,
      msg.rows[0]?.id,
      spec.kind ?? "image",
      `MEDIA.${RUN}.${++waSeq}`,
      spec.mime ?? "image/png",
      spec.attempts ?? 0,
      spec.ageDays ?? 0,
    ],
  );
  return rows[0]?.id ?? "";
}

/** Answers from a list, in order, and counts its calls. */
class FakeDownloader implements MediaDownloader {
  calls: { waMediaId: string; phoneNumberId: string; kind: MediaKind }[] = [];
  constructor(
    private readonly answer: () => Promise<DownloadResult> | DownloadResult,
  ) {}
  async download(media: {
    waMediaId: string;
    phoneNumberId: string;
    kind: MediaKind;
  }): Promise<DownloadResult> {
    this.calls.push(media);
    return this.answer();
  }
}

function captureLog(): { lines: string[]; log: MediaLog } {
  const lines: string[] = [];
  const at =
    (level: string) =>
    (obj: object, msg: string): void => {
      lines.push(JSON.stringify({ level, obj, msg }));
    };
  return {
    lines,
    log: {
      error: at("error"),
      warn: at("warn"),
      info: at("info"),
      debug: at("debug"),
    },
  };
}

const fetcher = (
  shops: Shop[],
  downloader: MediaDownloader,
  options: MediaFetcherOptions = {},
): MediaFetcher =>
  new MediaFetcher(db, downloader, {
    log: captureLog().log,
    ...options,
    restaurantScope: shops.map((s) => s.id),
  });

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  webhook = new WebhookService(
    db,
    new ConversationService(new RecordingWhatsAppSender()),
  );
});

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0)
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  await audit.end();
});

// ---------------------------------------------------------------------------
// The webhook — §7.1
// ---------------------------------------------------------------------------

describe("the webhook writes a pending row for a message relayed to an order (§7.1)", () => {
  it("an image after an order → pending, image/jpeg, Meta's id", async () => {
    const s = await shop("w-image");
    const from = nextPhone();
    await order(s, from);

    expect(
      await webhook.ingest(
        delivery(s.pid!, from, {
          type: "image",
          image: { id: "IMG1", mime_type: "image/jpeg", caption: "الإشعار" },
        }),
      ),
    ).toEqual(["stored"]);

    expect(await mediaOf(s)).toMatchObject([
      {
        kind: "image",
        wa_media_id: "IMG1",
        mime_type: "image/jpeg",
        file_name: null,
        state: "pending",
        attempts: 0,
        content: null,
        finished: false,
      },
    ]);
  });

  it("a voice note → audio, its MIME type as sent", async () => {
    const s = await shop("w-audio");
    const from = nextPhone();
    await order(s, from);

    await webhook.ingest(
      delivery(s.pid!, from, {
        type: "audio",
        audio: { id: "AUD1", mime_type: "audio/ogg; codecs=opus", voice: true },
      }),
    );

    expect(await mediaOf(s)).toMatchObject([
      { kind: "audio", mime_type: "audio/ogg; codecs=opus" },
    ]);
  });

  it("a PDF → pdf, with its filename", async () => {
    const s = await shop("w-pdf");
    const from = nextPhone();
    await order(s, from);

    await webhook.ingest(
      delivery(s.pid!, from, {
        type: "document",
        document: {
          id: "DOC1",
          mime_type: "application/pdf",
          filename: "إيصال.pdf",
        },
      }),
    );

    expect(await mediaOf(s)).toMatchObject([
      { kind: "pdf", file_name: "إيصال.pdf" },
    ]);
  });

  it("a screenshot sent as a file (image/png) → image", async () => {
    const s = await shop("w-shot");
    const from = nextPhone();
    await order(s, from);

    await webhook.ingest(
      delivery(s.pid!, from, {
        type: "document",
        document: { id: "DOC2", mime_type: "image/png", filename: "a.png" },
      }),
    );

    expect(await mediaOf(s)).toMatchObject([
      { kind: "image", mime_type: "image/png", file_name: null },
    ]);
  });

  it("a video → no row", async () => {
    const s = await shop("w-video");
    const from = nextPhone();
    await order(s, from);

    expect(
      await webhook.ingest(
        delivery(s.pid!, from, {
          type: "video",
          video: { id: "VID1", mime_type: "video/mp4" },
        }),
      ),
    ).toEqual(["stored"]);

    expect(await mediaOf(s)).toEqual([]);
  });

  it("🔴 an image with no order → no row: the message is stored, its file is not", async () => {
    const s = await shop("w-noorder");
    const from = nextPhone();

    expect(
      await webhook.ingest(
        delivery(s.pid!, from, {
          type: "image",
          image: { id: "IMG2", mime_type: "image/jpeg" },
        }),
      ),
    ).toEqual(["stored"]);

    const { rows } = await audit.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM inbound_messages WHERE restaurant_id = $1`,
      [s.id],
    );
    expect(rows[0]?.n).toBe(1);
    expect(await mediaOf(s)).toEqual([]);
  });

  it("an image while the bot keeps quiet for staff (brief م-ج) → a row", async () => {
    const s = await shop("w-silence");
    const from = nextPhone();
    // Older than the relay's 180 minutes: the silence alone links it.
    const o = await order(s, from, { status: "preparing", ageMinutes: 300 });
    await audit.query(
      `INSERT INTO staff_messages (restaurant_id, order_id, client_id, body,
                                   send_state, silence_until)
       VALUES ($1, $2, $3, 'مرحبا', 'sent', now() + interval '1 hour')`,
      [s.id, o, randomUUID()],
    );

    await webhook.ingest(
      delivery(s.pid!, from, {
        type: "image",
        image: { id: "IMG3", mime_type: "image/jpeg" },
      }),
    );

    expect(await mediaOf(s)).toMatchObject([
      { kind: "image", state: "pending" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The queue — §7.2
// ---------------------------------------------------------------------------

describe("the queue (§7.2)", () => {
  it("stored: the bytes, their size and the image's pixels; finished", async () => {
    const s = await shop("q-stored");
    const id = await pendingMedia(s);
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));

    const result = await fetcher([s], fake).tick();

    expect(result.outcomes).toEqual([{ mediaId: id, outcome: "stored" }]);
    expect(fake.calls).toEqual([
      { waMediaId: expect.any(String), phoneNumberId: s.pid, kind: "image" },
    ]);
    const [row] = await mediaOf(s);
    expect(row).toMatchObject({
      state: "stored",
      attempts: 1,
      size_bytes: PNG.length,
      width: 1080,
      height: 1920,
      finished: true,
    });
    expect(Buffer.compare(row!.content!, Buffer.from(PNG))).toBe(0);
  });

  it("a voice note stored: no pixels", async () => {
    const s = await shop("q-audio");
    await pendingMedia(s, { kind: "audio", mime: "audio/ogg; codecs=opus" });

    await fetcher(
      [s],
      new FakeDownloader(() => ({ kind: "stored", bytes: PNG })),
    ).tick();

    expect(await mediaOf(s)).toMatchObject([
      { state: "stored", width: null, height: null },
    ]);
  });

  it("too_large (Meta's announced size): no content, its size kept", async () => {
    const s = await shop("q-large");
    await pendingMedia(s);

    await fetcher(
      [s],
      new FakeDownloader(() => ({ kind: "too_large", sizeBytes: 9_000_000 })),
    ).tick();

    expect(await mediaOf(s)).toMatchObject([
      {
        state: "too_large",
        size_bytes: 9_000_000,
        content: null,
        finished: true,
      },
    ]);
  });

  it("a MIME type Meta answers that the kind may not store → failed", async () => {
    const s = await shop("q-unsupported");
    await pendingMedia(s);

    const result = await fetcher(
      [s],
      new FakeDownloader(() => ({
        kind: "unsupported",
        mimeType: "image/webp",
      })),
    ).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["unsupported"]);
    expect(await mediaOf(s)).toMatchObject([
      { state: "failed", finished: true },
    ]);
  });

  it("a MIME type the webhook carried that the kind may not store → failed, Meta never asked", async () => {
    const s = await shop("q-webp");
    await pendingMedia(s, { mime: "image/webp" });
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));

    await fetcher([s], fake).tick();

    expect(fake.calls).toHaveLength(0);
    expect(await mediaOf(s)).toMatchObject([{ state: "failed" }]);
  });

  it("a failure → attempts 1, still pending, due again in about 30 s", async () => {
    const s = await shop("q-retry");
    await pendingMedia(s);

    const result = await fetcher(
      [s],
      new FakeDownloader(() => ({
        kind: "failed",
        reason: "file request refused",
        httpStatus: 500,
      })),
    ).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["retry"]);
    const [row] = await mediaOf(s);
    expect(row).toMatchObject({
      state: "pending",
      attempts: 1,
      finished: false,
    });
    expect(row!.due_in_seconds).toBeGreaterThan(25);
    expect(row!.due_in_seconds).toBeLessThanOrEqual(30);
  });

  it("the sixth failure → failed", async () => {
    const s = await shop("q-sixth");
    await pendingMedia(s, { attempts: 5 });

    const result = await fetcher(
      [s],
      new FakeDownloader(() => ({
        kind: "failed",
        reason: "x",
        httpStatus: null,
      })),
    ).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["failed"]);
    expect(await mediaOf(s)).toMatchObject([
      { state: "failed", attempts: 6, finished: true },
    ]);
  });

  it("🔴 8 days old → failed, and the downloader never called", async () => {
    const s = await shop("q-old");
    await pendingMedia(s, { ageDays: 8 });
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));

    const result = await fetcher([s], fake).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["expired"]);
    expect(fake.calls).toHaveLength(0);
    expect(await mediaOf(s)).toMatchObject([{ state: "failed" }]);
  });

  it("a restaurant with no whatsapp_phone_id → failed, and an error line", async () => {
    const s = await shop("q-nophone", { phoneNumberId: null });
    await pendingMedia(s);
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));
    const { lines, log } = captureLog();

    const result = await fetcher([s], fake, { log }).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["no_sender_number"]);
    expect(fake.calls).toHaveLength(0);
    expect(await mediaOf(s)).toMatchObject([{ state: "failed" }]);
    expect(lines.some((l) => l.includes('"level":"error"'))).toBe(true);
  });

  it("🔴 two cycles at once (both past the listing) → one download", async () => {
    const s = await shop("q-parallel");
    await pendingMedia(s);
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothListed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = async (): Promise<void> => {
      arrived += 1;
      if (arrived === 2) release();
      await bothListed;
    };

    const [a, b] = await Promise.all([
      fetcher([s], fake, { beforeClaim: barrier }).tick(),
      fetcher([s], fake, { beforeClaim: barrier }).tick(),
    ]);

    expect(arrived).toBe(2);
    expect(fake.calls).toHaveLength(1);
    expect([...a.outcomes, ...b.outcomes].map((o) => o.outcome)).toEqual([
      "stored",
    ]);
  });

  /** A downloader held until released, telling when its download began. */
  const held = (
    bytes: Uint8Array,
  ): {
    downloader: FakeDownloader;
    started: Promise<void>;
    release: () => void;
  } => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let begun: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const downloader = new FakeDownloader(async () => {
      begun();
      await gate;
      return { kind: "stored", bytes };
    });
    return { downloader, started, release };
  };

  /**
   * 🔴 Ordered, not raced: the old worker claims and is held mid-download;
   *    its lease ends and a new worker claims and is held too; the old one
   *    comes back **first**, while the row is still `pending` — the one
   *    case `state = 'pending'` alone does not refuse — then the new one.
   */
  it("🔴 an old worker back after its lease ended, the new one still downloading → its write refused, the new one's kept", async () => {
    const s = await shop("q-stale");
    await pendingMedia(s);
    const OLD = Uint8Array.from([...PNG, 0xaa]);
    const old = held(OLD);
    const fresh = held(PNG);
    const { lines, log } = captureLog();

    const oldCycle = fetcher([s], old.downloader, { log }).tick();
    await old.started;
    // The lease ends; another worker claims the row.
    await audit.query(
      `UPDATE inbound_media SET next_attempt_at = now() WHERE restaurant_id = $1`,
      [s.id],
    );
    const freshCycle = fetcher([s], fresh.downloader).tick();
    await fresh.started;
    old.release();
    const stale = await oldCycle;
    fresh.release();
    const stored = await freshCycle;

    expect(stale.outcomes.map((o) => o.outcome)).toEqual(["stale"]);
    expect(stored.outcomes.map((o) => o.outcome)).toEqual(["stored"]);
    const [row] = await mediaOf(s);
    expect(row).toMatchObject({ state: "stored", attempts: 2 });
    expect(Buffer.compare(row!.content!, Buffer.from(PNG))).toBe(0);
    expect(lines.some((l) => l.includes("claimed again since"))).toBe(true);
  });

  it("another restaurant's row is left alone", async () => {
    const s = await shop("q-mine");
    const other = await shop("q-other");
    await pendingMedia(s);
    await pendingMedia(other);
    const fake = new FakeDownloader(() => ({ kind: "stored", bytes: PNG }));

    await fetcher([s], fake).tick();

    expect(fake.calls).toHaveLength(1);
    expect(await mediaOf(s)).toMatchObject([{ state: "stored" }]);
    expect(await mediaOf(other)).toMatchObject([
      { state: "pending", attempts: 0 },
    ]);
  });

  it("the lease is longer than the longest download: the info request's default timeout and the file's, with room", () => {
    const sendTimeout = parseEnv({
      ENGINE_DATABASE_URL: "postgres://x",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "x",
      WHATSAPP_APP_SECRET: "x",
      WHATSAPP_ACCESS_TOKEN: "x",
    }).WHATSAPP_SEND_TIMEOUT_MS;
    expect(sendTimeout).toBe(10_000);
    expect(MEDIA_DOWNLOAD_TIMEOUT_MS).toBe(60_000);
    expect(MEDIA_LEASE_SECONDS * 1000).toBeGreaterThan(
      sendTimeout + MEDIA_DOWNLOAD_TIMEOUT_MS + 30_000,
    );
  });
});

// ---------------------------------------------------------------------------
// MetaMediaDownloader — §7.3, against a local server
// ---------------------------------------------------------------------------

describe("MetaMediaDownloader against a local server (§7.3)", () => {
  const TOKEN = "test-token-local-server-only";
  let server: Server;
  let base: string;
  let seen: { path: string; authorization: string | undefined }[] = [];
  /** What the server answers for the file, set by each test. */
  let info: Record<string, unknown> = {};
  let file: { status: number; type: string; chunks: Buffer[] } = {
    status: 200,
    type: "image/jpeg",
    chunks: [],
  };
  let fileSent = 0;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      seen.push({
        path: req.url ?? "",
        authorization: req.headers.authorization,
      });
      if ((req.url ?? "").startsWith("/v21.0/missing")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":{"code":100}}');
        return;
      }
      if ((req.url ?? "").startsWith("/v21.0/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ url: `${base}/file`, ...info }));
        return;
      }
      res.writeHead(file.status, { "content-type": file.type });
      const write = (i: number): void => {
        const chunk = file.chunks[i];
        if (chunk === undefined) {
          res.end();
          return;
        }
        res.write(chunk, () => {
          fileSent += chunk.length;
          write(i + 1);
        });
      };
      write(0);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const downloader = (): MetaMediaDownloader =>
    new MetaMediaDownloader(TOKEN, base, "v21.0", 2000, 2000);
  const reset = (): void => {
    seen = [];
    fileSent = 0;
    info = { mime_type: "image/jpeg", file_size: 4 };
    file = {
      status: 200,
      type: "image/jpeg",
      chunks: [Buffer.from([1, 2, 3, 4])],
    };
  };

  it("🔴 the bearer token on both requests, phone_number_id in the first; the file's bytes", async () => {
    reset();
    const result = await downloader().download(
      { waMediaId: "MID 1", phoneNumberId: "PN/1", kind: "image" },
      100,
    );

    expect(result).toEqual({
      kind: "stored",
      bytes: Uint8Array.from([1, 2, 3, 4]),
    });
    expect(seen).toEqual([
      {
        path: "/v21.0/MID%201?phone_number_id=PN%2F1",
        authorization: `Bearer ${TOKEN}`,
      },
      { path: "/file", authorization: `Bearer ${TOKEN}` },
    ]);
  });

  it("announced bigger than the limit → too_large, and the file never asked", async () => {
    reset();
    info = { mime_type: "image/jpeg", file_size: 9_000_000 };

    expect(
      await downloader().download(
        { waMediaId: "M", phoneNumberId: "P", kind: "image" },
        5_242_880,
      ),
    ).toEqual({ kind: "too_large", sizeBytes: 9_000_000 });
    expect(seen.map((r) => r.path)).toEqual(["/v21.0/M?phone_number_id=P"]);
  });

  it("🔴 Meta says 1 KB and sends more → too_large, the reading stopped at the limit", async () => {
    reset();
    info = { mime_type: "image/jpeg", file_size: 1024 };
    file.chunks = Array.from({ length: 50 }, () => Buffer.alloc(64 * 1024, 7));

    const result = await downloader().download(
      { waMediaId: "M", phoneNumberId: "P", kind: "image" },
      100_000,
    );

    expect(result.kind).toBe("too_large");
    if (result.kind !== "too_large") throw new Error("unreachable");
    expect(result.sizeBytes).toBeGreaterThan(100_000);
    // Far from the 3.2 MB the server had to send.
    expect(result.sizeBytes).toBeLessThan(1_000_000);
  });

  it("a MIME type the kind may not store → unsupported, the file never asked", async () => {
    reset();
    info = { mime_type: "image/webp", file_size: 4 };

    expect(
      await downloader().download(
        { waMediaId: "M", phoneNumberId: "P", kind: "image" },
        100,
      ),
    ).toEqual({ kind: "unsupported", mimeType: "image/webp" });
    expect(seen).toHaveLength(1);
  });

  it("an HTML page for the file → failed", async () => {
    reset();
    file = {
      status: 200,
      type: "text/html; charset=utf-8",
      chunks: [Buffer.from("<html>")],
    };

    expect(
      await downloader().download(
        { waMediaId: "M", phoneNumberId: "P", kind: "image" },
        100,
      ),
    ).toMatchObject({ kind: "failed", httpStatus: 200 });
  });

  it("a 404 for the info → failed, the file never asked", async () => {
    reset();

    expect(
      await downloader().download(
        { waMediaId: "missing", phoneNumberId: "P", kind: "image" },
        100,
      ),
    ).toMatchObject({ kind: "failed", httpStatus: 404 });
    expect(seen).toHaveLength(1);
  });

  it("a 404 for the file → failed", async () => {
    reset();
    file = {
      status: 404,
      type: "application/json",
      chunks: [Buffer.from("{}")],
    };

    expect(
      await downloader().download(
        { waMediaId: "M", phoneNumberId: "P", kind: "image" },
        100,
      ),
    ).toMatchObject({ kind: "failed", httpStatus: 404 });
  });

  it("end to end: the queue with the real downloader on the local server → stored", async () => {
    reset();
    info = { mime_type: "image/png", file_size: PNG.length };
    file = { status: 200, type: "image/png", chunks: [Buffer.from(PNG)] };
    const s = await shop("e2e");
    await pendingMedia(s);

    const result = await fetcher([s], downloader()).tick();

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["stored"]);
    expect(await mediaOf(s)).toMatchObject([
      { state: "stored", width: 1080, height: 1920, size_bytes: PNG.length },
    ]);
    expect(fileSent).toBe(PNG.length);
  });
});
