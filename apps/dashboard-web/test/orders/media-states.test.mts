/**
 * A customer's media in the conversation (brief م-هـ-ب §5.2, mhb-5): what
 * each state shows — the word, its word «… — لا تظهر هنا», or the media —
 * and the caption under it in every state. `mediaView` decides; the
 * conversation's view carries it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type {
  CustomerOrBotMessage,
  MediaState,
  OrderMessageMedia,
} from "@sufria/shared";
import {
  conversationView,
  mediaView,
} from "../../features/orders/lib/details.ts";

const MEDIA = (
  kind: OrderMessageMedia["kind"],
  state: MediaState,
  extra: Partial<OrderMessageMedia> = {},
): OrderMessageMedia => ({
  id: `media-${kind}`,
  kind,
  state,
  mimeType:
    kind === "image"
      ? "image/jpeg"
      : kind === "audio"
        ? "audio/ogg; codecs=opus"
        : "application/pdf",
  sizeBytes: state === "stored" ? 1000 : null,
  width: kind === "image" && state === "stored" ? 1125 : null,
  height: kind === "image" && state === "stored" ? 2436 : null,
  fileName: kind === "pdf" ? "receipt.pdf" : null,
  ...extra,
});

const msg = (
  kind: CustomerOrBotMessage["kind"],
  media: OrderMessageMedia | null,
  caption: string | null = null,
): CustomerOrBotMessage => ({
  id: `m-${kind}-${media?.state ?? "none"}`,
  direction: "inbound",
  kind,
  text: null,
  location: null,
  media,
  caption,
  at: "2026-10-15T11:50:00.000Z",
});

const KIND_OF = { image: "image", audio: "audio", pdf: "document" } as const;
const WORD = { image: "صورة", audio: "رسالة صوتية", pdf: "ملف" } as const;

test("§5.2: null media — the word as before, «… — لا تظهر هنا»", () => {
  for (const kind of ["image", "audio", "document", "video"] as const)
    assert.deepEqual(mediaView(kind, null, false), {
      word: {
        image: "صورة — لا تظهر هنا",
        audio: "رسالة صوتية — لا تظهر هنا",
        document: "ملف — لا تظهر هنا",
        video: "فيديو — لا تظهر هنا",
      }[kind],
      media: null,
    });
});

test("🔴 §5.2: pending — its word alone, «صورة», never «— لا تظهر هنا»", () => {
  for (const kind of ["image", "audio", "pdf"] as const)
    assert.deepEqual(
      mediaView(KIND_OF[kind], MEDIA(kind, "pending"), false),
      { word: WORD[kind], media: null },
      kind,
    );
});

test("§5.2: failed and too_large — «… — لا تظهر هنا»", () => {
  for (const state of ["failed", "too_large"] as const)
    for (const kind of ["image", "audio", "pdf"] as const)
      assert.deepEqual(
        mediaView(KIND_OF[kind], MEDIA(kind, state), false),
        { word: `${WORD[kind]} — لا تظهر هنا`, media: null },
        `${kind} ${state}`,
      );
});

test("§5.2: stored — the image with the API's size, the player, the PDF's row", () => {
  assert.deepEqual(mediaView("image", MEDIA("image", "stored"), false), {
    word: null,
    media: {
      kind: "image",
      id: "media-image",
      width: 1125,
      height: 2436,
      fallback: "صورة — لا تظهر هنا",
    },
  });
  assert.deepEqual(mediaView("audio", MEDIA("audio", "stored"), false), {
    word: null,
    media: {
      kind: "audio",
      id: "media-audio",
      label: "رسالة صوتية",
      fallback: "رسالة صوتية — لا تظهر هنا",
    },
  });
  // A PDF's message is `kind: "document"`: its word is «ملف».
  assert.deepEqual(mediaView("document", MEDIA("pdf", "stored"), false), {
    word: null,
    media: {
      kind: "pdf",
      id: "media-pdf",
      fileName: "receipt.pdf",
      fallback: "ملف — لا تظهر هنا",
    },
  });
});

test("§5.2: a stored image whose 3 downloads to the page failed — «صورة — لا تظهر هنا»", () => {
  assert.deepEqual(mediaView("image", MEDIA("image", "stored"), true), {
    word: "صورة — لا تظهر هنا",
    media: null,
  });
});

test("the conversation: a stored image not downloaded yet is the image's frame, not a word", () => {
  const [m] = conversationView([
    msg("image", MEDIA("image", "stored")),
  ]).messages;
  assert.equal(m!.word, null);
  assert.equal(m!.media?.kind, "image");
});

test("the conversation: 3 failed downloads (the page's store) — the failure's word", () => {
  const view = conversationView(
    [msg("image", MEDIA("image", "stored"))],
    true,
    null,
    (id) => id === "media-image",
  );
  assert.equal(view.messages[0]!.word, "صورة — لا تظهر هنا");
  assert.equal(view.messages[0]!.media, null);
});

test("🔴 the caption shows in every state (decision 13 of the brief)", () => {
  const caption = "حوّلت 40 باسم أحمد";
  const states: Array<OrderMessageMedia | null> = [
    null,
    MEDIA("image", "pending"),
    MEDIA("image", "stored"),
    MEDIA("image", "failed"),
    MEDIA("image", "too_large"),
  ];
  for (const media of states) {
    const [m] = conversationView([msg("image", media, caption)]).messages;
    assert.equal(m!.caption, caption, media?.state ?? "null");
  }
  const [pdf] = conversationView([
    msg("document", MEDIA("pdf", "stored"), caption),
  ]).messages;
  assert.equal(pdf!.caption, caption);
});

test("a video stays a word — no media row exists for it", () => {
  const [m] = conversationView([msg("video", null)]).messages;
  assert.deepEqual([m!.word, m!.media], ["فيديو — لا تظهر هنا", null]);
});

test("a text and a bot message carry no media and no caption", () => {
  const view = conversationView([
    { ...msg("text", null), text: "مرحبا" },
    { ...msg("text", null), id: "b", direction: "outbound", text: "أهلا" },
  ]);
  for (const m of view.messages)
    assert.deepEqual([m.media, m.caption], [null, null]);
});
