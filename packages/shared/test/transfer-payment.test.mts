/**
 * mha-2 · the transfer payment's texts — brief م-هـ-أ §3 and §4.2–§4.3:
 * ن1 in the summary, the notifier's message by payment (`orderNoticeAr`),
 * ن2 letter for letter, ن3 the relay's own line, and decision 8 — the
 * accepted message sent in place of a `preparing` the notifier never told.
 *
 * `statusNotificationAr` is left as it was: its own file holds it, a cash
 * order's `preparing` silent included.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CUSTOMER_TEXTS_AR,
  ORDER_STATUSES,
  ORDER_STATUS_MESSAGE_AR,
  RELAY_STATUS_LINE_AR,
  SUMMARY_PAYMENT_LINE_AR,
  SUMMARY_TRANSFER_LINE_AR,
  TRANSFER_ACCEPTED_TAIL_AR,
  buildOrderSummary,
  orderNoticeAr,
  statusNotificationAr,
  type CartDisplayLine,
  type OrderNoticeInput,
  type OrderNoticePayment,
  type OrderStatus,
} from "@sufria/shared";

const N1 = "الدفع بالتحويل، ونرسل لك التفاصيل مع تأكيد الطلب.";
const DETAILS = "جوال باي 059XXXXXXX (عرض تجريبي)";

const LINES: CartDisplayLine[] = [
  {
    menuNumber: 2,
    name: "شاورما عربي",
    qty: 2,
    lineTotalMinor: 1200,
    note: null,
  },
];

const CASH: OrderNoticePayment = { method: "cash" };
const ONLINE: OrderNoticePayment = { method: "online" };
const transfer = (
  over: Partial<Extract<OrderNoticePayment, { method: "transfer" }>> = {},
): OrderNoticePayment => ({
  method: "transfer",
  total: "13.50",
  currency: "ILS",
  details: DETAILS,
  ...over,
});

const notice = (
  status: OrderStatus,
  payment: OrderNoticePayment,
  acceptedNoticedBefore: boolean,
  over: Partial<OrderNoticeInput> = {},
): string | null =>
  orderNoticeAr({
    status,
    fulfillmentType: "pickup",
    cancellationReason: null,
    orderNumber: 101,
    payment,
    acceptedNoticedBefore,
    ...over,
  });

const N2 = (total: string, currency: string, details = DETAILS): string =>
  [
    "أكّدنا طلبك رقم 101.",
    `حوّل ${total} ${currency} على:`,
    details,
    "أرسل إشعار التحويل هنا، ونبدأ تحضير طلبك بعد وصوله.",
  ].join("\n");

// --- ن1 -----------------------------------------------------------------------

test("ن1 letter for letter, and «الدفع نقدا.» as it was", () => {
  assert.equal(SUMMARY_TRANSFER_LINE_AR, N1);
  assert.equal(SUMMARY_PAYMENT_LINE_AR, "الدفع نقدا.");
});

test("the summary of a transfer restaurant: ن1 in the cash line's place — pickup and delivery", () => {
  const delivery = {
    type: "delivery",
    feeMinor: 150,
    address: "الرمال، شارع عمر المختار",
  } as const;
  for (const fulfillment of [{ type: "pickup" } as const, delivery]) {
    const cash = buildOrderSummary(LINES, 1200, fulfillment, "ILS", "cash");
    const viaTransfer = buildOrderSummary(
      LINES,
      1200,
      fulfillment,
      "ILS",
      "transfer",
    );
    assert.equal(viaTransfer, cash.replace(SUMMARY_PAYMENT_LINE_AR, N1));
    const lines = viaTransfer.split("\n");
    assert.equal(lines.at(-2), N1);
    assert.ok(!viaTransfer.includes(SUMMARY_PAYMENT_LINE_AR));
  }
});

// --- §4.3's table, row by row -------------------------------------------------

test("accepted: cash and online «أكّدنا طلبك رقم 101.», noticed before or not", () => {
  for (const payment of [CASH, ONLINE])
    for (const before of [false, true])
      assert.equal(notice("accepted", payment, before), "أكّدنا طلبك رقم 101.");
});

test("accepted: transfer → ن2, noticed before or not", () => {
  for (const before of [false, true])
    assert.equal(notice("accepted", transfer(), before), N2("13.50", "شيكل"));
});

test("🔴 preparing, the accepted message never sent: cash and online «أكّدنا طلبك رقم 101.» (decision 8)", () => {
  for (const payment of [CASH, ONLINE])
    assert.equal(notice("preparing", payment, false), "أكّدنا طلبك رقم 101.");
});

test("🔴 preparing, the accepted message never sent: transfer → ن2, not ن3 (decision 8)", () => {
  assert.equal(notice("preparing", transfer(), false), N2("13.50", "شيكل"));
});

test("preparing, the accepted message sent: cash and online silent, as today", () => {
  for (const payment of [CASH, ONLINE])
    assert.equal(notice("preparing", payment, true), null);
});

test("🔴 preparing, the accepted message sent: transfer → ن3, `RELAY_STATUS_LINE_AR.preparing` filled (decision 7)", () => {
  const n3 = notice("preparing", transfer(), true);
  assert.equal(n3, "نحضّر طلبك رقم 101 الآن.");
  assert.equal(
    n3,
    RELAY_STATUS_LINE_AR.preparing.replace("[رقم الطلب]", "101"),
  );
});

test("every other status: `statusNotificationAr`, for every payment and either way", () => {
  const others = ORDER_STATUSES.filter(
    (s) => s !== "accepted" && s !== "preparing",
  );
  for (const status of others)
    for (const payment of [CASH, ONLINE, transfer()])
      for (const before of [false, true])
        for (const cancellationReason of [null, "نفد الخبز"]) {
          const input = {
            status,
            fulfillmentType: "delivery",
            cancellationReason,
            orderNumber: 101,
          } as const;
          assert.equal(
            notice(status, payment, before, input),
            statusNotificationAr(input),
            `${status} · ${payment.method} · ${String(before)}`,
          );
        }
});

test("a transfer order cancelled from pending_acceptance: the cancellation as today, no details", () => {
  const body = notice("cancelled", transfer(), false, {
    cancellationReason: "نفد الخبز",
  });
  assert.equal(body, "ألغينا طلبك رقم 101 — نفد الخبز.");
  assert.ok(!body.includes(DETAILS));
});

// --- ن2 -------------------------------------------------------------------------

test("ن2: delivery — the order's total, fee included, as the database holds it", () => {
  assert.equal(
    notice("accepted", transfer({ total: "16.50" }), false, {
      fulfillmentType: "delivery",
    }),
    N2("16.50", "شيكل"),
  );
});

test("ن2: in د.أ, and «.00» dropped like every amount", () => {
  assert.equal(
    notice("accepted", transfer({ total: "15.00", currency: "JOD" }), false),
    N2("15", "د.أ"),
  );
});

test("🔴 ن2's first line is the cash order's accepted message itself", () => {
  const cash = notice("accepted", CASH, false);
  const viaTransfer = notice("accepted", transfer(), false)!;
  assert.equal(viaTransfer.split("\n")[0], cash);
  assert.ok(
    viaTransfer.startsWith(
      ORDER_STATUS_MESSAGE_AR.accepted.replace("[رقم الطلب]", "101"),
    ),
  );
});

test("🔴 the restaurant's details go in as written: a slot inside them is never filled", () => {
  const details = "حوّل على [رقم الطلب] و[المجموع] و$& ثم [العملة]";
  assert.equal(
    notice("accepted", transfer({ details }), false),
    N2("13.50", "شيكل", details),
  );
});

test("details on several lines stay as the restaurant wrote them", () => {
  const details = "جوال باي 059XXXXXXX\nأو بنك فلسطين 12345";
  assert.equal(
    notice("accepted", transfer({ details }), false),
    N2("13.50", "شيكل", details),
  );
});

test("🔴 a transfer order whose details are gone (`null`): the cash message, every row", () => {
  const gone = transfer({ details: null });
  assert.equal(notice("accepted", gone, false), "أكّدنا طلبك رقم 101.");
  assert.equal(notice("preparing", gone, false), "أكّدنا طلبك رقم 101.");
  assert.equal(notice("preparing", gone, true), null);
});

// --- the guard ---------------------------------------------------------------

test("ن1 and ن2's lines are in the guarded list, with Western digits alone", () => {
  for (const text of [SUMMARY_TRANSFER_LINE_AR, TRANSFER_ACCEPTED_TAIL_AR]) {
    assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(text), text);
    assert.ok(!/[٠-٩۰-۹]/u.test(text), text);
  }
  assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(ORDER_STATUS_MESSAGE_AR.accepted));
  assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(RELAY_STATUS_LINE_AR.preparing));
});
