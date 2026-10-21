/**
 * mha-2 · a customer's media — brief م-هـ-أ §4.4: what a WhatsApp message
 * holds (`mediaFromMessage`, the table row by row), what may be stored, the
 * 5 MiB limit against 0021's own CHECK, and an image's size from bytes
 * written here by hand.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MEDIA_KINDS,
  MEDIA_MAX_BYTES,
  imageDimensions,
  isAllowedMime,
  mediaFromMessage,
  mimeBase,
} from "@sufria/shared";

// --- mediaFromMessage ---------------------------------------------------------

test("image with id and mime_type → image, the MIME type as sent", () => {
  assert.deepEqual(
    mediaFromMessage("image", {
      type: "image",
      image: { id: "M1", mime_type: "image/jpeg", caption: "الإشعار" },
    }),
    { kind: "image", waMediaId: "M1", mimeType: "image/jpeg", fileName: null },
  );
});

test("audio with id and mime_type → audio, «; codecs=opus» kept", () => {
  assert.deepEqual(
    mediaFromMessage("audio", {
      audio: { id: "M2", mime_type: "audio/ogg; codecs=opus", voice: true },
    }),
    {
      kind: "audio",
      waMediaId: "M2",
      mimeType: "audio/ogg; codecs=opus",
      fileName: null,
    },
  );
});

test("a PDF document → pdf, with its filename", () => {
  assert.deepEqual(
    mediaFromMessage("document", {
      document: {
        id: "M3",
        mime_type: "application/pdf",
        filename: "إيصال.pdf",
      },
    }),
    {
      kind: "pdf",
      waMediaId: "M3",
      mimeType: "application/pdf",
      fileName: "إيصال.pdf",
    },
  );
  assert.equal(
    mediaFromMessage("document", {
      document: { id: "M3", mime_type: "Application/PDF ; x=1" },
    })?.fileName,
    null,
  );
});

test("a screenshot sent as a document (image/png or image/jpeg) → image", () => {
  for (const mime_type of ["image/png", "image/jpeg", " IMAGE/JPEG;q=1"])
    assert.deepEqual(
      mediaFromMessage("document", {
        document: { id: "M4", mime_type, filename: "Screenshot.png" },
      }),
      { kind: "image", waMediaId: "M4", mimeType: mime_type, fileName: null },
    );
});

test("anything else → null: a video, a sticker, another document, a missing id or MIME type", () => {
  const nothing: [string, unknown][] = [
    ["video", { video: { id: "M5", mime_type: "video/mp4" } }],
    ["sticker", { sticker: { id: "M6", mime_type: "image/webp" } }],
    ["document", { document: { id: "M7", mime_type: "application/zip" } }],
    ["document", { document: { id: "M7", mime_type: "image/webp" } }],
    ["image", { image: { mime_type: "image/jpeg" } }],
    ["image", { image: { id: "", mime_type: "image/jpeg" } }],
    ["audio", { audio: { id: "M8" } }],
    ["document", { document: { id: "M9" } }],
    ["image", { audio: { id: "M8", mime_type: "audio/ogg" } }],
    ["text", { text: { body: "مرحبا" } }],
    ["image", null],
    ["image", "image"],
  ];
  for (const [type, payload] of nothing)
    assert.equal(
      mediaFromMessage(type, payload),
      null,
      JSON.stringify(payload),
    );
});

// --- what may be stored -------------------------------------------------------

test("the MIME base: before «;», no spaces, lower case", () => {
  assert.equal(mimeBase("Audio/OGG; codecs=opus"), "audio/ogg");
  assert.equal(mimeBase(" image/jpeg "), "image/jpeg");
});

test("allowed, by kind (§4.4)", () => {
  const allowed = {
    image: ["image/jpeg", "image/png"],
    audio: ["audio/ogg", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr"],
    pdf: ["application/pdf"],
  };
  for (const kind of MEDIA_KINDS) {
    for (const mime of allowed[kind]) assert.ok(isAllowedMime(kind, mime));
    assert.ok(isAllowedMime(kind, `${allowed[kind][0]!.toUpperCase()}; x=1`));
  }
  for (const [kind, mime] of [
    ["image", "image/webp"],
    ["image", "image/gif"],
    ["image", "text/html"],
    ["audio", "image/jpeg"],
    ["audio", "video/mp4"],
    ["pdf", "image/png"],
    ["pdf", "text/html"],
  ] as const)
    assert.ok(!isAllowedMime(kind, mime), `${kind} ${mime}`);
});

test("🔴 MEDIA_MAX_BYTES is the number in 0021's CHECK", () => {
  const sql = readFileSync(
    new URL(
      "../../../db/migrations/0021_transfer_and_inbound_media.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const limit = /size_bytes <= (\d+)/u.exec(sql)?.[1];
  assert.equal(MEDIA_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(Number(limit), MEDIA_MAX_BYTES);
});

// --- an image's size ----------------------------------------------------------

const be32 = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];

/** A PNG's signature and IHDR, and nothing after. */
const png = (width: number, height: number): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ]);

/** A segment: marker, length (itself included), data. */
const segment = (marker: number, data: number[]): number[] => [
  0xff,
  marker,
  ...be16(data.length + 2),
  ...data,
];
/** A start-of-frame's data: precision, height, width, one component. */
const frame = (width: number, height: number): number[] => [
  8,
  ...be16(height),
  ...be16(width),
  1,
  1,
  0x11,
  0,
];
const jpeg = (...segments: number[][]): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, ...segments.flat()]);

test("PNG: IHDR's width and height", () => {
  assert.deepEqual(imageDimensions(png(1080, 1920)), {
    width: 1080,
    height: 1920,
  });
});

test("JPEG with SOF0, after APP0 and DQT", () => {
  assert.deepEqual(
    imageDimensions(
      jpeg(
        segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
        segment(0xdb, [0, 1, 2, 3]),
        segment(0xc0, frame(640, 480)),
      ),
    ),
    { width: 640, height: 480 },
  );
});

test("🔴 JPEG with SOF2 (progressive), after DHT (C4) and DAC (CC), which are not frames", () => {
  assert.deepEqual(
    imageDimensions(
      jpeg(
        segment(0xc4, [0, 1, 2, 3, 4, 5, 6]),
        segment(0xcc, [9, 9, 9, 9, 9, 9, 9]),
        [0xff, 0xff],
        segment(0xc2, frame(1080, 1920)),
      ),
    ),
    { width: 1080, height: 1920 },
  );
});

test("broken or unknown → null", () => {
  const broken: [string, Uint8Array][] = [
    ["empty", new Uint8Array()],
    ["GIF", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])],
    ["PNG cut inside IHDR", png(10, 10).slice(0, 20)],
    [
      "PNG with no IHDR first",
      Uint8Array.from([
        ...png(10, 10).slice(0, 12),
        0x49,
        0x44,
        0x41,
        0x54,
        ...be32(10),
        ...be32(10),
      ]),
    ],
    ["PNG of zero width", png(0, 10)],
    ["JPEG cut in its frame", jpeg(segment(0xc0, frame(640, 480))).slice(0, 9)],
    [
      "JPEG with SOS before any frame",
      jpeg(segment(0xda, [1, 2, 3]), segment(0xc0, frame(640, 480))),
    ],
    [
      "JPEG with a segment that does not start with 0xFF",
      Uint8Array.from([0xff, 0xd8, 0x00, 0xc0]),
    ],
    [
      "JPEG with a zero length",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 0]),
    ],
    ["JPEG of zero height", jpeg(segment(0xc0, frame(640, 0)))],
    ["JPEG that ends before a frame", jpeg(segment(0xe0, [1, 2]))],
  ];
  for (const [label, bytes] of broken)
    assert.equal(imageDimensions(bytes), null, label);
});
