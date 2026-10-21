/**
 * The notifier's message by the order's payment — brief م-هـ-أ §4.3,
 * Mohammed's decisions 4, 7 and 8 (20 October 2026).
 *
 * `statusNotificationAr` (`domain.ts`) stays what it was — the status alone,
 * a cash order's message — and this builds on it: a transfer order is told
 * where to transfer when it is accepted (ن2), and that its transfer arrived
 * when staff start preparing it (ن3). And an accepted message the notifier
 * never sent — «اقبل» then «ابدأ التحضير» inside one cycle — is sent in
 * place of `preparing`, for cash too (decision 8).
 *
 * 🔴 A module of its own, off `domain.ts` (Mohammed's decision ج, 13
 *    October): ن3 is `RELAY_STATUS_LINE_AR.preparing`, from `relay-line.ts`,
 *    and `domain.ts` imports nothing from there. The engine alone reads it.
 */
import {
  CURRENCY_LABEL_AR,
  CURRENCY_SLOT,
  ORDER_NUMBER_SLOT,
  ORDER_STATUS_MESSAGE_AR,
  TOTAL_SLOT,
  TRANSFER_ACCEPTED_TAIL_AR,
  TRANSFER_DETAILS_SLOT,
  fillSlots,
  formatMinor,
  priceToMinor,
  statusNotificationAr,
  type Currency,
  type StatusNotificationInput,
} from "./domain.js";
import { RELAY_STATUS_LINE_AR } from "./relay-line.js";

/** How the order is paid, as the notifier read it from the claim. */
export type OrderNoticePayment =
  | { readonly method: "cash" | "online" }
  | {
      readonly method: "transfer";
      /** `orders.total`, as the database holds it: `"13.50"`, the fee in. */
      readonly total: string;
      readonly currency: Currency;
      /**
       * `restaurants.transfer_details`, as the restaurant wrote it. `null`
       * once the restaurant went back to cash and cleared them after the
       * order was placed: the cash message then, and the notifier warns.
       */
      readonly details: string | null;
    };

export interface OrderNoticeInput extends StatusNotificationInput {
  readonly payment: OrderNoticePayment;
  /**
   * The order's accepted message was claimed before this one —
   * `accepted_notice_at` as it was before the claim (0021).
   */
  readonly acceptedNoticedBefore: boolean;
}

/**
 * The customer's message for an order the notifier claimed, or `null` when
 * silence is the decision. Brief م-هـ-أ §4.3's table, to the letter:
 *
 * | status    | noticed before | cash / online          | transfer |
 * |-----------|----------------|------------------------|----------|
 * | accepted  | —              | «أكّدنا طلبك رقم N.»    | ن2       |
 * | preparing | false          | «أكّدنا طلبك رقم N.»    | ن2       |
 * | preparing | true           | `null`                 | ن3       |
 * | the rest  | —              | `statusNotificationAr` | the same |
 *
 * A transfer order with no details left is a cash one.
 */
export function orderNoticeAr(order: OrderNoticeInput): string | null {
  const transfer =
    order.payment.method === "transfer" && order.payment.details !== null
      ? order.payment
      : null;
  const number = { [ORDER_NUMBER_SLOT]: String(order.orderNumber) };

  const accepted = (): string =>
    transfer === null
      ? fillSlots(ORDER_STATUS_MESSAGE_AR.accepted, number)
      : // 🔴 One pass over the whole message: the restaurant's details go in
        //    as written, and a slot inside them is never filled.
        fillSlots(
          `${ORDER_STATUS_MESSAGE_AR.accepted}\n${TRANSFER_ACCEPTED_TAIL_AR}`,
          {
            ...number,
            [TOTAL_SLOT]: formatMinor(priceToMinor(transfer.total)),
            [CURRENCY_SLOT]: CURRENCY_LABEL_AR[transfer.currency],
            [TRANSFER_DETAILS_SLOT]: transfer.details!,
          },
        );

  switch (order.status) {
    case "accepted":
      return accepted();
    case "preparing":
      if (!order.acceptedNoticedBefore) return accepted();
      return transfer === null
        ? null
        : fillSlots(RELAY_STATUS_LINE_AR.preparing, number);
    default:
      return statusNotificationAr(order);
  }
}
