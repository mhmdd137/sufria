/**
 * A customer's messages on the dashboard, and its sound — brief م-ب §4: the
 * two dictionaries verbatim, and the five functions the card, the
 * conversation and the API read.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_MESSAGES_UI_AR,
  DASHBOARD_SOUND_UI_AR,
  conversationKindAr,
  mapUrl,
  messageKind,
  messageKindLabelAr,
  unreadLabelAr,
} from "@sufria/shared";

test("DASHBOARD_MESSAGES_UI_AR and DASHBOARD_SOUND_UI_AR are Mohammed's text, verbatim", () => {
  assert.deepEqual(DASHBOARD_MESSAGES_UI_AR, {
    kind: {
      audio: "رسالة صوتية",
      image: "صورة",
      video: "فيديو",
      document: "ملف",
      location: "موقع",
      other: "رسالة لا تظهر هنا",
    },
    notShown: " — لا تظهر هنا",
    openMap: "افتح الخريطة",
    returned: "رسائل جديدة على طلبات منتهية",
    unread: "رسائل جديدة: [العدد]",
  });
  assert.deepEqual(DASHBOARD_SOUND_UI_AR, {
    mute: "اكتم الصوت",
    unmute: "شغّل الصوت",
    muted: "صوت التنبيه مكتوم على هذا الجهاز",
    blocked: "المتصفح أوقف الصوت",
  });
});

// --- a customer's messages — brief م-ب §4 ----------------------------------

test("messageKind: a body is text whatever its type; else the five, else other", () => {
  assert.equal(messageKind("text", "وين طلبي؟"), "text");
  assert.equal(messageKind("image", "a caption"), "text");
  for (const t of ["audio", "image", "video", "document", "location"])
    assert.equal(messageKind(t, null), t);
  for (const t of ["sticker", "contacts", "unsupported", "voice", ""])
    assert.equal(messageKind(t, null), "other");
});

test("the card: each kind its word alone", () => {
  assert.equal(messageKindLabelAr("audio"), "رسالة صوتية");
  assert.equal(messageKindLabelAr("image"), "صورة");
  assert.equal(messageKindLabelAr("video"), "فيديو");
  assert.equal(messageKindLabelAr("document"), "ملف");
  assert.equal(messageKindLabelAr("location"), "موقع");
  assert.equal(messageKindLabelAr("other"), "رسالة لا تظهر هنا");
});

test("the conversation: «— لا تظهر هنا» after audio, image, video and a file", () => {
  assert.equal(conversationKindAr("audio"), "رسالة صوتية — لا تظهر هنا");
  assert.equal(conversationKindAr("image"), "صورة — لا تظهر هنا");
  assert.equal(conversationKindAr("video"), "فيديو — لا تظهر هنا");
  assert.equal(conversationKindAr("document"), "ملف — لا تظهر هنا");
});

test("🔴 the conversation: «رسالة لا تظهر هنا» stays alone — never said twice", () => {
  assert.equal(conversationKindAr("other"), "رسالة لا تظهر هنا");
});

test("the conversation: «موقع» alone — its link follows", () => {
  assert.equal(conversationKindAr("location"), "موقع");
});

test("mapUrl: Google Maps at the point, Western digits, a minus kept", () => {
  assert.equal(
    mapUrl({ latitude: 31.9539, longitude: 35.9106 }),
    "https://www.google.com/maps?q=31.9539,35.9106",
  );
  assert.equal(
    mapUrl({ latitude: -33.8688, longitude: -151.2093 }),
    "https://www.google.com/maps?q=-33.8688,-151.2093",
  );
});

test("unreadLabelAr: «رسائل جديدة: 3»", () => {
  assert.equal(unreadLabelAr(3), "رسائل جديدة: 3");
});
