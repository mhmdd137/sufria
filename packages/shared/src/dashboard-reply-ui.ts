/**
 * A staff member writes to the order's customer — brief م-د, Mohammed's
 * texts of 17 October (23:39), verbatim. A file of its own, as
 * `dashboard-menu-ui.ts` is (brief ي-ب-9 §3): a page that imports anything
 * of a module carries all of it, and only the order's page shows these.
 *
 * «راسل الزبون» is `DASHBOARD_UI_AR.details.messageCustomer`, and a failed
 * «شغّل الرد الآلي» is `DASHBOARD_UI_AR.errors.stepFailed`.
 *
 * The same pattern otherwise: the exact wording held by a test, and
 * `check:numerals` walking every string.
 */
import type { StaffMessageFailure } from "./dashboard-api.js";
import { COUNT_SLOT } from "./dashboard-ui.js";

/** A time, «14:30», in the silence line and under a staff bubble. */
export const TIME_SLOT = "[الوقت]";
/** The staff member's name under their bubble. */
export const STAFF_NAME_SLOT = "[الاسم]";

export const DASHBOARD_REPLY_UI_AR = {
  /** The field's placeholder, and its name for a screen reader. */
  placeholder: "اكتب رسالة للزبون",
  send: "أرسل",
  silence: `الرد الآلي متوقف لهذا الزبون حتى ${TIME_SLOT}`,
  resume: "شغّل الرد الآلي",
  sending: "جارٍ الإرسال…",
  /** Why a staff message was not sent; `send_failed` also for the screen's own failures. */
  failure: {
    send_failed: "لم تُرسل: تعذّر الإرسال.",
    expired: "لم تُرسل: تأخّرت أكثر من دقيقتين، فأوقفناها.",
    window_closed: "لم تُرسل: مرّت 24 ساعة على آخر رسالة من الزبون.",
    no_sender_number: "لم تُرسل: رقم واتساب المطعم غير مربوط.",
  },
  editAndSend: "عدّل وأرسل",
  /** In place of the line and the field, once the 24 hours passed. */
  closed: "لا يمكن الرد من هنا: مرّت 24 ساعة على آخر رسالة من الزبون.",
  /** Under a staff bubble; with no name, the time alone. */
  meta: `${STAFF_NAME_SLOT} · ${TIME_SLOT}`,
  /**
   * The conversation before the order, folded into one line at the start
   * (brief م-د-9, decision 7): «محادثة الطلب مع البوت (24)» and its button.
   */
  orderChat: {
    title: "محادثة الطلب مع البوت",
    count: `(${COUNT_SLOT})`,
    show: "اعرضها",
    hide: "اخفِها",
  },
} as const;

/**
 * A text with one time in it, in three pieces: the screen sets `time` in
 * the numbers' font, and `before + time + after` is the text.
 */
export type TimedText = { before: string; time: string; after: string };

/** Split at the time first, then filled: a name never moves the split. */
function timed(
  template: string,
  values: Record<string, string>,
  time: string,
): TimedText {
  const fill = (part: string) =>
    part.replace(/\[[^\]]+\]/gu, (slot) => values[slot] ?? slot);
  const [before = "", after = ""] = template.split(TIME_SLOT);
  return { before: fill(before), time, after: fill(after) };
}

/** «الرد الآلي متوقف لهذا الزبون حتى 15:30». */
export function silenceLineAr(time: string): TimedText {
  return timed(DASHBOARD_REPLY_UI_AR.silence, {}, time);
}

/**
 * Why a staff message was not sent: its `failure`, or `local` — the screen
 * could not hand it to the API (the network, a 5xx after its retries, a
 * 400, a 404, `client_id_reused`) — which reads as `send_failed`.
 */
export function staffFailureAr(failure: StaffMessageFailure | "local"): string {
  return DASHBOARD_REPLY_UI_AR.failure[
    failure === "local" ? "send_failed" : failure
  ];
}

/**
 * A text with one count in it, in three pieces — as `TimedText`: the
 * screen sets `count` in the numbers' font.
 */
export type CountedText = { before: string; count: string; after: string };

/** «(24)» after «محادثة الطلب مع البوت». */
export function orderChatCountAr(count: number): CountedText {
  const [before = "", after = ""] =
    DASHBOARD_REPLY_UI_AR.orderChat.count.split(COUNT_SLOT);
  return { before, count: String(count), after };
}

/** «أحمد · 14:30» under a staff bubble — «14:30» alone once the account is gone. */
export function staffMetaAr(name: string | null, time: string): TimedText {
  if (name === null) return { before: "", time, after: "" };
  return timed(DASHBOARD_REPLY_UI_AR.meta, { [STAFF_NAME_SLOT]: name }, time);
}
