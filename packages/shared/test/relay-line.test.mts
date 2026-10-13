/**
 * ma-2 · the relay line, and the status messages with their number — brief
 * م-أ §3 (Mohammed's decisions 3 and 10). Pure: no database.
 *
 * 🔴 Every expected text is written out here by hand, character by character,
 *    from the brief's texts — not built with the functions under test. A
 *    snapshot computed by the code it checks agrees with any change.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CUSTOMER_TEXTS_AR,
  ORDER_STATUS_MESSAGE_AR,
  RELAY_CONTACT_AR,
  RELAY_MENU_HINT_AR,
  RELAY_RECEIVED_AR,
  RELAY_RECEIVED_CLOSED_AR,
  RELAY_STATUS_LINE_AR,
  RELAY_TEXTS_AR,
  readyMessageAr,
  relayLineAr,
  statusNotificationAr,
  type RelayOpenOrder,
} from "@sufria/shared";

const PHONE = "0790000099";

const open = (
  orderNumber: number,
  status: RelayOpenOrder["status"],
  fulfillmentType: RelayOpenOrder["fulfillmentType"] = "pickup",
): RelayOpenOrder => ({ orderNumber, status, fulfillmentType });

test("the new texts are Mohammed's, verbatim (decision 3)", () => {
  assert.equal(
    RELAY_STATUS_LINE_AR.pending_acceptance,
    "استلمنا طلبك رقم [رقم الطلب]، وما أكّدناه بعد.",
  );
  assert.equal(
    RELAY_STATUS_LINE_AR.preparing,
    "نحضّر طلبك رقم [رقم الطلب] الآن.",
  );
  assert.equal(RELAY_RECEIVED_AR, "وصلت رسالتك للمطعم.");
  assert.equal(
    RELAY_RECEIVED_CLOSED_AR,
    "وصلت رسالتك للمطعم بخصوص طلبك رقم [رقم الطلب].",
  );
  assert.equal(RELAY_CONTACT_AR, "للتواصل مباشرة: [رقم المطعم]");
  assert.equal(RELAY_MENU_HINT_AR, "لطلب جديد، اكتب «منيو».");
});

// ---------------------------------------------------------------------------
// The line, to the letter — one open order per status
// ---------------------------------------------------------------------------

test("pending_acceptance — the brief's first shape", () => {
  assert.equal(
    relayLineAr(
      { kind: "open", orders: [open(108, "pending_acceptance")] },
      PHONE,
    ),
    "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("accepted — the confirmation's own text", () => {
  assert.equal(
    relayLineAr({ kind: "open", orders: [open(108, "accepted")] }, PHONE),
    "أكّدنا طلبك رقم 108.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("preparing", () => {
  assert.equal(
    relayLineAr({ kind: "open", orders: [open(108, "preparing")] }, PHONE),
    "نحضّر طلبك رقم 108 الآن.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("ready · pickup", () => {
  assert.equal(
    relayLineAr(
      { kind: "open", orders: [open(108, "ready", "pickup")] },
      PHONE,
    ),
    "طلبك رقم 108 جاهز للاستلام.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("ready · delivery", () => {
  assert.equal(
    relayLineAr(
      { kind: "open", orders: [open(108, "ready", "delivery")] },
      PHONE,
    ),
    "طلبك رقم 108 خرج للتوصيل.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("🔴 two orders on their way — the brief's second shape, oldest first", () => {
  assert.equal(
    relayLineAr(
      {
        kind: "open",
        orders: [open(107, "ready", "pickup"), open(108, "preparing")],
      },
      PHONE,
    ),
    "طلبك رقم 107 جاهز للاستلام.\n" +
      "نحضّر طلبك رقم 108 الآن.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("a finished order alone — the brief's third shape: no status, no «وصلت» line of its own", () => {
  assert.equal(
    relayLineAr({ kind: "closed", orderNumber: 108 }, PHONE),
    "وصلت رسالتك للمطعم بخصوص طلبك رقم 108.\n" +
      "للتواصل مباشرة: 0790000099\n" +
      "لطلب جديد، اكتب «منيو».",
  );
});

test("🔴 no contact_phone — no contact line at all, the rule of HANDOFF_AR", () => {
  assert.equal(
    relayLineAr(
      { kind: "open", orders: [open(108, "pending_acceptance")] },
      null,
    ),
    "استلمنا طلبك رقم 108، وما أكّدناه بعد.\n" +
      "وصلت رسالتك للمطعم.\n" +
      "لطلب جديد، اكتب «منيو».",
  );
  assert.equal(
    relayLineAr({ kind: "closed", orderNumber: 108 }, null),
    "وصلت رسالتك للمطعم بخصوص طلبك رقم 108.\n" + "لطلب جديد، اكتب «منيو».",
  );
});

test("no slot left unfilled, and no empty line, whatever the subject", () => {
  const subjects = [
    ...(["pending_acceptance", "accepted", "preparing", "ready"] as const).map(
      (status) => ({
        kind: "open" as const,
        orders: [open(5, status, "delivery")],
      }),
    ),
    { kind: "closed" as const, orderNumber: 5 },
  ];
  for (const subject of subjects)
    for (const phone of [PHONE, null]) {
      const text = relayLineAr(subject, phone);
      assert.doesNotMatch(text, /\[[^\]]+\]/u, text);
      assert.doesNotMatch(text, /\n\n/u, text);
    }
});

test("🔴 the relay texts are in the guarded dictionary", () => {
  assert.equal(RELAY_TEXTS_AR.length, 6);
  for (const template of RELAY_TEXTS_AR)
    assert.ok(
      ALL_CUSTOMER_TEXTS_AR.includes(template),
      `«${template}» برّا الحراسة`,
    );
});

// ---------------------------------------------------------------------------
// The status messages with their number (decision 10, table ب)
// ---------------------------------------------------------------------------

test("the six status messages, verbatim — «استلمنا» unchanged", () => {
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.pending_acceptance,
    "استلمنا طلبك رقم [رقم الطلب] — التأكيد خلال دقائق.",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.accepted,
    "أكّدنا طلبك رقم [رقم الطلب].",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.ready.pickup,
    "طلبك رقم [رقم الطلب] جاهز للاستلام.",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.ready.delivery,
    "طلبك رقم [رقم الطلب] خرج للتوصيل.",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.cancelled.restaurant,
    "ألغينا طلبك رقم [رقم الطلب] — [السبب].",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.cancelled.restaurant_no_reason,
    "ألغينا طلبك رقم [رقم الطلب].",
  );
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.cancelled.customer,
    "ألغينا الطلب رقم [رقم الطلب] حسب طلبك.",
  );
});

test("filled with the order's number, as the notifier sends them", () => {
  const order = {
    fulfillmentType: "pickup" as const,
    cancellationReason: null,
    orderNumber: 108,
  };
  assert.equal(
    statusNotificationAr({ ...order, status: "accepted" }),
    "أكّدنا طلبك رقم 108.",
  );
  assert.equal(
    statusNotificationAr({ ...order, status: "ready" }),
    "طلبك رقم 108 جاهز للاستلام.",
  );
  assert.equal(
    statusNotificationAr({
      ...order,
      status: "ready",
      fulfillmentType: "delivery",
    }),
    "طلبك رقم 108 خرج للتوصيل.",
  );
  assert.equal(
    statusNotificationAr({
      ...order,
      status: "cancelled",
      cancellationReason: "نفد الخبز",
    }),
    "ألغينا طلبك رقم 108 — نفد الخبز.",
  );
  assert.equal(
    statusNotificationAr({ ...order, status: "cancelled" }),
    "ألغينا طلبك رقم 108.",
  );
  assert.equal(readyMessageAr("delivery", 7), "طلبك رقم 7 خرج للتوصيل.");
});
