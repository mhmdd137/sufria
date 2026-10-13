/**
 * The relay line — brief م-أ (Mohammed's decision 3, 13 October 2026), the
 * texts verbatim from him. What a customer with an order on its way, or one
 * finished a moment ago, gets instead of the menu: where each order stands,
 * that the restaurant has their message, its number, and how to order again.
 * One message, built by `relayLineAr` alone.
 *
 * 🔴 A module of its own, off `domain.ts` (Mohammed's decision ج, 13
 *    October): nothing on the dashboard reads it, and the dashboard's pages
 *    import `domain.ts`. `ALL_CUSTOMER_TEXTS_AR` came along: it lists the
 *    relay texts too, and `domain.ts` imports nothing from here.
 */
import {
  CART_TEXT_TEMPLATES_AR,
  ORDER_NUMBER_SLOT,
  ORDER_STATUS_MESSAGE_AR,
  ORDER_STATUS_TEXTS_AR,
  ORDER_TEXT_TEMPLATES_AR,
  RESTAURANT_PHONE_SLOT,
  fillSlots,
  readyMessageAr,
  type OrderStatus,
} from "./domain.js";

/**
 * An order still on its way (decision 1). The relay line names each by its
 * status; `completed` and `cancelled` are finished, and `expired` is neither
 * — no relay for it at all.
 */
export const RELAY_OPEN_STATUSES = [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready",
] as const satisfies readonly OrderStatus[];
export type RelayOpenStatus = (typeof RELAY_OPEN_STATUSES)[number];

/** A finished order: the relay line names its number, never its status. */
export const RELAY_CLOSED_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly OrderStatus[];

/**
 * The status line of the two open statuses with no customer message of their
 * own. `accepted` and `ready` take theirs from `ORDER_STATUS_MESSAGE_AR`
 * itself, never a copy.
 */
export const RELAY_STATUS_LINE_AR = {
  pending_acceptance: `استلمنا طلبك رقم ${ORDER_NUMBER_SLOT}، وما أكّدناه بعد.`,
  preparing: `نحضّر طلبك رقم ${ORDER_NUMBER_SLOT} الآن.`,
} as const;

/** After the status lines, when an order is on its way. */
export const RELAY_RECEIVED_AR = "وصلت رسالتك للمطعم.";

/**
 * A finished order alone: in place of the status lines and
 * `RELAY_RECEIVED_AR`. 🔴 No status, by decision: «سلّمنا طلبك» to a customer
 *    writing that it came incomplete reads as the restaurant defending itself.
 */
export const RELAY_RECEIVED_CLOSED_AR = `وصلت رسالتك للمطعم بخصوص طلبك رقم ${ORDER_NUMBER_SLOT}.`;

/** `contact_phone` NULL = no such line at all, the rule of `HANDOFF_AR`. */
export const RELAY_CONTACT_AR = `للتواصل مباشرة: ${RESTAURANT_PHONE_SLOT}`;

/** The last line: «منيو» always starts a new order (decision 5). */
export const RELAY_MENU_HINT_AR = "لطلب جديد، اكتب «منيو».";

/** The relay line's own templates (brief م-أ) — into the same guard. */
export const RELAY_TEXTS_AR: readonly string[] = [
  RELAY_STATUS_LINE_AR.pending_acceptance,
  RELAY_STATUS_LINE_AR.preparing,
  RELAY_RECEIVED_AR,
  RELAY_RECEIVED_CLOSED_AR,
  RELAY_CONTACT_AR,
  RELAY_MENU_HINT_AR,
];

/**
 * **كل نص يصل الزبون**، وهو ما تمشي عليه الحراسة فعلا (ج §15.6).
 *
 * 🔴 §0 من بريف ج ادّعى أن القاموس المحروس يورّث «حراسات الأرقام والممنوعات».
 *    الواقع حارسان اثنان: الأرقام العربية-الهندية، واسم الصنف ليس فاعلا.
 *    **لا حارس للممنوعات اللهجية** — فحصها يدوي، وبوابته مهمة مستقلة بعد ج.
 *    ولا تُقرأ هذه القائمة على أنها تحرس أكثر مما تحرس.
 *
 *    و`ORDER_STATUS_MESSAGE_AR` كانت خارج الحراسة كليا حتى الآن: «استلمنا
 *    طلبك» شُحنت بلا أن يفحصها شيء.
 */
export const ALL_CUSTOMER_TEXTS_AR: readonly string[] = [
  ...CART_TEXT_TEMPLATES_AR,
  ...ORDER_TEXT_TEMPLATES_AR,
  ...ORDER_STATUS_TEXTS_AR,
  ...RELAY_TEXTS_AR,
];

/** An order on its way, as the relay line names it. */
export interface RelayOpenOrder {
  readonly orderNumber: number;
  readonly status: RelayOpenStatus;
  readonly fulfillmentType: "pickup" | "delivery";
}

/**
 * What the relay line is about (brief م-أ, decisions 1 and 2): the orders on
 * their way, oldest first — at least one — or, when there is none, the one
 * finished order the message is about.
 */
export type RelaySubject =
  | { readonly kind: "open"; readonly orders: readonly RelayOpenOrder[] }
  | { readonly kind: "closed"; readonly orderNumber: number };

/**
 * The relay line, whole — brief م-أ, decision 3, to the letter, `\n` between
 * its lines and no empty one:
 *
 *   [a status line per open order, in the order given — oldest first]
 *   وصلت رسالتك للمطعم.
 *   — or, a finished order alone, «وصلت رسالتك للمطعم بخصوص طلبك رقم …»
 *     in place of both —
 *   للتواصل مباشرة: [رقم المطعم]     ← only when `contactPhone` is not NULL
 *   لطلب جديد، اكتب «منيو».
 *
 * `accepted` and `ready` say what the status messages say, from
 * `ORDER_STATUS_MESSAGE_AR` itself. Pure: which orders, and in what order, is
 * the engine's reading.
 */
export function relayLineAr(
  subject: RelaySubject,
  contactPhone: string | null,
): string {
  const numbered = (template: string, orderNumber: number): string =>
    fillSlots(template, { [ORDER_NUMBER_SLOT]: String(orderNumber) });
  const statusLine = (order: RelayOpenOrder): string => {
    switch (order.status) {
      case "pending_acceptance":
      case "preparing":
        return numbered(RELAY_STATUS_LINE_AR[order.status], order.orderNumber);
      case "accepted":
        return numbered(ORDER_STATUS_MESSAGE_AR.accepted, order.orderNumber);
      case "ready":
        return readyMessageAr(order.fulfillmentType, order.orderNumber);
      default: {
        const unreachable: never = order.status;
        throw new Error(`حالة طلب غير معروفة: ${String(unreachable)}`);
      }
    }
  };
  return [
    ...(subject.kind === "open"
      ? [...subject.orders.map(statusLine), RELAY_RECEIVED_AR]
      : [numbered(RELAY_RECEIVED_CLOSED_AR, subject.orderNumber)]),
    ...(contactPhone === null
      ? []
      : [
          fillSlots(RELAY_CONTACT_AR, {
            [RESTAURANT_PHONE_SLOT]: contactPhone,
          }),
        ]),
    RELAY_MENU_HINT_AR,
  ].join("\n");
}
