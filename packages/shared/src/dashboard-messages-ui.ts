/**
 * A customer's messages on the dashboard, and its alert sound — brief م-ب,
 * Mohammed's texts of 13 October (19:20), verbatim. A file of its own, as
 * `dashboard-menu-ui.ts` is (brief ي-ب-9 §3, decision 2B): `DASHBOARD_UI_AR`
 * is one object, and every page — `/login` too — carries all of it.
 *
 * Two dictionaries, so a page carries only the one it reads: the messages'
 * words reach «الطلبات» and an order's page; the sound's, the header and its
 * strips on every page behind login. The same pattern otherwise: each one's
 * exact wording held by a test, and `check:numerals` walking every string.
 */
import type { MessageKind, MessageLocation } from "./dashboard-api.js";
import { COUNT_SLOT } from "./dashboard-ui.js";

/**
 * The card, the returned group and the conversation. On the card a kind is
 * its word alone; in the conversation `notShown` follows it — but never after
 * `other` (it would say it twice) or `location` (its link follows).
 */
export const DASHBOARD_MESSAGES_UI_AR = {
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
  /** Over the closed orders a message brought back to «الطلبات». */
  returned: "رسائل جديدة على طلبات منتهية",
  /** The count's label, for a screen reader. */
  unread: `رسائل جديدة: ${COUNT_SLOT}`,
} as const;

/** The header's sound button and the two strips under the header. */
export const DASHBOARD_SOUND_UI_AR = {
  mute: "اكتم الصوت",
  unmute: "شغّل الصوت",
  muted: "صوت التنبيه مكتوم على هذا الجهاز",
  blocked: "المتصفح أوقف الصوت",
} as const;

/** The kinds that have a word of their own: every one but `text`. */
export type MessageKindWord = Exclude<MessageKind, "text">;

const KIND_TYPES: readonly MessageKindWord[] = [
  "audio",
  "image",
  "video",
  "document",
  "location",
];

/**
 * What a customer message is (brief م-ب): `text` whenever it has a body;
 * else its WhatsApp `message_type` when it is one of the five with a word,
 * and `other` for anything else — a sticker, contacts, `unsupported`, a type
 * WhatsApp adds tomorrow.
 */
export function messageKind(
  messageType: string,
  body: string | null,
): MessageKind {
  if (body !== null) return "text";
  return (KIND_TYPES as readonly string[]).includes(messageType)
    ? (messageType as MessageKindWord)
    : "other";
}

/** The card's word for a message with no text: «رسالة صوتية». */
export function messageKindLabelAr(kind: MessageKindWord): string {
  return DASHBOARD_MESSAGES_UI_AR.kind[kind];
}

/**
 * The conversation's word for a message with no text: «رسالة صوتية — لا
 * تظهر هنا». `other` and `location` stay alone: the first already says it,
 * and the second's link follows.
 */
export function conversationKindAr(kind: MessageKindWord): string {
  const word = DASHBOARD_MESSAGES_UI_AR.kind[kind];
  return kind === "other" || kind === "location"
    ? word
    : `${word}${DASHBOARD_MESSAGES_UI_AR.notShown}`;
}

/** A location's map: Google Maps at the point, the numbers as `String` writes them. */
export function mapUrl(location: MessageLocation): string {
  return `https://www.google.com/maps?q=${String(location.latitude)},${String(location.longitude)}`;
}

/** The unread count's label, for a screen reader: «رسائل جديدة: 3». */
export function unreadLabelAr(count: number): string {
  return DASHBOARD_MESSAGES_UI_AR.unread.replace(COUNT_SLOT, String(count));
}
