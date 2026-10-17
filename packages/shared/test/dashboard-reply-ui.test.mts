/**
 * A staff member writes to the customer (brief م-د §2): the dictionary
 * verbatim — Mohammed's texts of 17 October — and the three functions the
 * order's page reads.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_REPLY_UI_AR,
  STAFF_MESSAGE_FAILURES,
  silenceLineAr,
  staffFailureAr,
  staffMetaAr,
  type TimedText,
} from "@sufria/shared";

const whole = (t: TimedText) => `${t.before}${t.time}${t.after}`;

test("DASHBOARD_REPLY_UI_AR is Mohammed's text, verbatim", () => {
  assert.deepEqual(DASHBOARD_REPLY_UI_AR, {
    placeholder: "اكتب رسالة للزبون",
    send: "أرسل",
    silence: "الرد الآلي متوقف لهذا الزبون حتى [الوقت]",
    resume: "شغّل الرد الآلي",
    sending: "جارٍ الإرسال…",
    failure: {
      send_failed: "لم تُرسل: تعذّر الإرسال.",
      expired: "لم تُرسل: تأخّرت أكثر من دقيقتين، فأوقفناها.",
      window_closed: "لم تُرسل: مرّت 24 ساعة على آخر رسالة من الزبون.",
      no_sender_number: "لم تُرسل: رقم واتساب المطعم غير مربوط.",
    },
    editAndSend: "عدّل وأرسل",
    closed: "لا يمكن الرد من هنا: مرّت 24 ساعة على آخر رسالة من الزبون.",
    meta: "[الاسم] · [الوقت]",
  });
});

test("silenceLineAr: the line with its time, the time a piece of its own", () => {
  const line = silenceLineAr("15:30");
  assert.equal(whole(line), "الرد الآلي متوقف لهذا الزبون حتى 15:30");
  assert.deepEqual(line, {
    before: "الرد الآلي متوقف لهذا الزبون حتى ",
    time: "15:30",
    after: "",
  });
});

test("staffFailureAr: each failure its reason; the screen's own reads as send_failed", () => {
  for (const f of STAFF_MESSAGE_FAILURES)
    assert.equal(staffFailureAr(f), DASHBOARD_REPLY_UI_AR.failure[f]);
  assert.equal(staffFailureAr("local"), "لم تُرسل: تعذّر الإرسال.");
});

test("staffMetaAr: «الاسم · الوقت», the time alone with no name — the «·» from here", () => {
  assert.equal(whole(staffMetaAr("أحمد", "14:30")), "أحمد · 14:30");
  assert.deepEqual(staffMetaAr("أحمد", "14:30"), {
    before: "أحمد · ",
    time: "14:30",
    after: "",
  });
  assert.deepEqual(staffMetaAr(null, "14:30"), {
    before: "",
    time: "14:30",
    after: "",
  });
  // A name that looks like a slot is a name: it never moves the time.
  assert.deepEqual(staffMetaAr("[الوقت]", "14:30"), {
    before: "[الوقت] · ",
    time: "14:30",
    after: "",
  });
});
