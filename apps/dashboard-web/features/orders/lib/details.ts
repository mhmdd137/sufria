/**
 * The order details page's decisions, apart from React (brief I §4, I-6):
 * what the page shows of an order and of its conversation. The components
 * only render what these return, so the rules are tested without a browser.
 */
import {
  DASHBOARD_REPLY_UI_AR,
  DASHBOARD_UI_AR,
  MAX_CANCELLATION_REASON_LENGTH,
  ORDER_STATUS_LABEL_AR,
  PAYMENT_STATUS_LABEL_AR,
  STAFF_TRANSITIONS,
  amountAr,
  clockTime,
  conversationKindAr,
  customerLabelAr,
  historyTime,
  itemsSummaryAr,
  mapUrl,
  nextStaffAction,
  orderNumberLabel,
  sinceAr,
  staffFailureAr,
  staffMetaAr,
  waLink,
  type Currency,
  type OrderDetail,
  type OrderMessage,
  type OrderMessagesResponse,
  type OrderStatus,
  type StaffAction,
  type StaffMessageSendState,
  type TimedText,
} from "@sufria/shared";
import { isMaskedCustomer } from "./board.ts";
import type { ShownMessage } from "./reply.ts";

/**
 * «الطلب» polls every 10 seconds (I-6), its conversation every 5 since brief
 * م-ب (decision 11: it was 30) — the staff member reading a customer's
 * messages sees the next one come.
 */
export const DETAIL_POLL_MS = 10_000;
export const MESSAGES_POLL_MS = 5_000;

export type DetailView = {
  /** The order number, as the card writes it — the page's <h1>. */
  number: string;
  status: OrderStatus;
  badge: string;
  /** «استلام» or «توصيل». */
  kind: string;
  /** «•••• 1234» — the full number is in `chat` alone. */
  customer: string;
  /** `customer` is the masked number: set in the numbers' font. */
  customerMasked: boolean;
  since: string;
  /** One per item: «شاورما ×2» and its line total with the currency. */
  lines: { label: string; amount: string }[];
  /** «رسوم التوصيل» — for a delivery alone. */
  deliveryFee: string | null;
  total: string;
  /** «محصَّل» for `collected`; nothing for `pending_cash`, by design. */
  payment: string | null;
  /** The customer's own words: shown `dir="auto"`. A delivery alone. */
  address: string | null;
  /**
   * Each status the order went through, with its time on this device:
   * `HH:MM` today, its date before.
   * The cancellation's carries the reason — staff's words, sent to the
   * customer as written — shown right under «ملغى» (I-9 #4); every other
   * entry, and a cancellation without one, `null`.
   */
  history: {
    key: string;
    status: OrderStatus;
    badge: string;
    time: string;
    reason: string | null;
  }[];
  /** The next step — the card's own; `null` once the order is done. */
  action: StaffAction | null;
  /** «إلغاء الطلب» — wherever the staff transitions allow `cancelled`. */
  canCancel: boolean;
  /** «راسل الزبون»: `https://wa.me/<digits>`. */
  chat: string;
};

export function detailView(
  order: OrderDetail,
  currency: Currency,
  now: number,
): DetailView {
  const delivery = order.fulfillmentType === "delivery";
  const reason =
    order.status === "cancelled" ? order.cancellationReason || null : null;
  // The last «ملغى»: a cancellation is the end of the history.
  const cancelled = order.history.findLastIndex((h) => h.to === "cancelled");
  return {
    number: orderNumberLabel(order.orderNumber),
    status: order.status,
    badge: ORDER_STATUS_LABEL_AR[order.status],
    kind: DASHBOARD_UI_AR.fulfillment[order.fulfillmentType],
    customer: customerLabelAr(order.customer),
    customerMasked: isMaskedCustomer(order.customer),
    // «منذ…» under 24 hours, its date from 24 on (I-9 #6).
    since: sinceAr(order.createdAt, now),
    // The card's rule for each line: a quantity of 1 is the name alone.
    lines: order.items.map((item) => ({
      label: itemsSummaryAr([item]),
      amount: amountAr(item.lineTotal, currency),
    })),
    deliveryFee: delivery ? amountAr(order.deliveryFee, currency) : null,
    total: amountAr(order.total, currency),
    payment: PAYMENT_STATUS_LABEL_AR[order.paymentStatus] ?? null,
    address: delivery ? order.deliveryAddress : null,
    history: order.history.map((h, i) => ({
      key: `${i}-${h.to}`,
      status: h.to,
      badge: ORDER_STATUS_LABEL_AR[h.to],
      // Today's «14:30»; before today «28/9 · 14:30» (I-9 #6).
      time: historyTime(h.at, now),
      reason: i === cancelled ? reason : null,
    })),
    action: nextStaffAction(order.status, order.fulfillmentType),
    canCancel: STAFF_TRANSITIONS[order.status].includes("cancelled"),
    chat: waLink(order.customer.phone),
  };
}

/**
 * The cancel dialog's counter, «12 / 300» (brief I §6) — drawn left to right
 * as one isolated group (`dir="ltr"` on its `.num`): inside the page's right
 * to left it read «300 / 12» (I-9 #3).
 */
export function reasonCounter(length: number): string {
  return `${length} / ${MAX_CANCELLATION_REASON_LENGTH}`;
}

/** The order's conversation, as the page holds it. */
export type MessagesState =
  | { kind: "loading" }
  /**
   * The answer whole: the messages, and whether the bot keeps quiet and
   * until when staff can write (brief م-د) — the line and the field.
   */
  | ({ kind: "ready" } & OrderMessagesResponse)
  | { kind: "failed" };

export function messagesReady(res: OrderMessagesResponse): MessagesState {
  return {
    kind: "ready",
    messages: res.messages,
    botSilence: res.botSilence,
    replyOpenUntil: res.replyOpenUntil,
  };
}

/** A bot message longer than this many lines opens on its first two (I-6). */
export const LONG_MESSAGE_LINES = 6;
export const PREVIEW_LINES = 2;

/**
 * Folded at the start once there are this many messages from before the
 * order (brief م-د-9): fewer show as they are — the line itself takes a
 * bubble's place.
 */
export const FOLD_MIN = 4;

export type ConversationView = {
  /**
   * The line above the messages: none kept at all, or the customer's alone —
   * an order from before the bot's replies were kept (0013).
   */
  notice: string | null;
  /**
   * The conversation with the bot that made the order (brief م-د-9,
   * decision 7): the customer's and the bot's messages from before the
   * order's `createdAt`, in their order — `FOLD_MIN` or more, folded into
   * one line at the start; `null` when there is no line, and they are in
   * `messages`.
   */
  beforeOrder: ConversationMessage[] | null;
  messages: ConversationMessage[];
};

export type ConversationMessage = {
  id: string;
  /**
   * The customer's at the start of the line, the bot's and staff's at its
   * end (brief م-د): three voices, staff's filled once it reached them.
   */
  from: "customer" | "bot" | "staff";
  /**
   * As it arrived — Arabic-Indic digits included: it is what they wrote.
   * `null` for a message with no text: `word` instead.
   */
  text: string | null;
  /**
   * A customer message with no text, by its kind (brief م-ب): «رسالة
   * صوتية — لا تظهر هنا», «موقع»…; `null` for a text.
   */
  word: string | null;
  /** A location's map link, when its point is known; else `null`. */
  map: string | null;
  /** The first lines of a long bot message; `null` for one shown whole. */
  preview: string | null;
  time: string;
  /** A staff message alone; `null` for the customer's and the bot's. */
  staff: StaffView | null;
};

/**
 * A staff message (brief م-د §3): its state — a bubble the screen sent and
 * no read brought back yet is `pending`, or `failed` when it never reached
 * the API — and what goes under it.
 */
export type StaffView = {
  state: StaffMessageSendState;
  /** `sent`: «[الاسم] · [الوقت]», the time alone with no name. */
  meta: TimedText | null;
  /** `pending`: «جارٍ الإرسال…»; `failed`: why. */
  note: string | null;
  /**
   * `failed` alone: «عدّل وأرسل» (`edit`), or «راسل الزبون» (`contact`) —
   * for `window_closed`, and for any failed one once the 24 hours passed
   * (`open` false: there is no field to edit in); none for
   * `no_sender_number`.
   */
  action: "edit" | "contact" | null;
  /** The screen's own bubble: its `clientId`; `null` for a server row. */
  local: string | null;
};

function staffView(
  m: Extract<ShownMessage, { direction: "staff" | "local" }>,
  open: boolean,
): StaffView {
  const local = m.direction === "local" ? m.clientId : null;
  const state = m.direction === "local" ? m.state : m.sendState;
  if (state === "sent" && m.direction === "staff")
    return {
      state,
      meta: staffMetaAr(m.staffName, clockTime(m.at)),
      note: null,
      action: null,
      local,
    };
  if (state !== "failed")
    return {
      state: "pending",
      meta: null,
      note: DASHBOARD_REPLY_UI_AR.sending,
      action: null,
      local,
    };
  const failure =
    m.direction === "local" ? "local" : (m.failure ?? "send_failed");
  const action =
    failure === "no_sender_number"
      ? null
      : failure === "window_closed" || !open
        ? "contact"
        : "edit";
  return { state, meta: null, note: staffFailureAr(failure), action, local };
}

/**
 * `open`: staff can still write to the customer (`replyOpenUntil`), so a
 * failed message can go back to the field. `orderCreatedAt`: the order's
 * `createdAt` — what came before it folds (`beforeOrder`); `null`, nothing.
 * Staff never write before the order, and a bubble of the screen's carries
 * this device's clock: theirs never fold.
 */
export function conversationView(
  messages: readonly ShownMessage[],
  open = true,
  orderCreatedAt: string | null = null,
): ConversationView {
  const notice =
    messages.length === 0
      ? DASHBOARD_UI_AR.conversation.empty
      : messages.every((m) => m.direction === "inbound")
        ? DASHBOARD_UI_AR.conversation.customerOnly
        : null;
  const created = orderCreatedAt === null ? null : Date.parse(orderCreatedAt);
  const earlier = (m: ShownMessage) =>
    created !== null &&
    (m.direction === "inbound" || m.direction === "outbound") &&
    Date.parse(m.at) < created;
  const shown = messages.map((m) => ({
    earlier: earlier(m),
    view: messageView(m, open),
  }));
  const folded = shown.filter((s) => s.earlier).length >= FOLD_MIN;
  return {
    notice,
    beforeOrder: folded
      ? shown.filter((s) => s.earlier).map((s) => s.view)
      : null,
    messages: (folded ? shown.filter((s) => !s.earlier) : shown).map(
      (s) => s.view,
    ),
  };
}

function messageView(m: ShownMessage, open: boolean): ConversationMessage {
  const time = clockTime(m.at);
  // Staff's are never folded, and always text (brief م-د).
  if (m.direction === "staff" || m.direction === "local")
    return {
      id: m.direction === "local" ? `local:${m.clientId}` : m.id,
      from: "staff",
      text: m.text,
      word: null,
      map: null,
      preview: null,
      time,
      staff: staffView(m, open),
    };
  const from = m.direction === "inbound" ? "customer" : "bot";
  if (m.kind !== "text" || m.text === null) {
    const kind = m.kind === "text" ? "other" : m.kind;
    return {
      id: m.id,
      from,
      text: null,
      word: conversationKindAr(kind),
      map: kind === "location" && m.location ? mapUrl(m.location) : null,
      preview: null,
      time,
      staff: null,
    };
  }
  const lines = m.text.split("\n");
  const long = m.direction === "outbound" && lines.length > LONG_MESSAGE_LINES;
  return {
    id: m.id,
    from,
    text: m.text,
    word: null,
    map: null,
    preview: long ? lines.slice(0, PREVIEW_LINES).join("\n") : null,
    time,
    staff: null,
  };
}

/**
 * «Read» (brief م-ب): after a read of the conversation, the customer message
 * to mark it read up to — the latest the page shows — or `null` when there
 * is none, or it is the one already marked. A failed mark leaves `marked`
 * as it was, so the next read tries again.
 */
export function seenUpTo(
  messages: readonly OrderMessage[],
  marked: string | null,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.direction === "inbound") return m.id === marked ? null : m.id;
  }
  return null;
}

/**
 * The order's page rings (brief م-ب-9 §2): a read that brings a customer
 * message the previous read did not have. The first read after the page
 * opens (`prev` null) never does — the staff member is looking — and a bot
 * message alone never does.
 */
export function newCustomerMessage(
  prev: readonly OrderMessage[] | null,
  next: readonly OrderMessage[],
): boolean {
  if (prev === null) return false;
  const known = new Set(prev.map((m) => m.id));
  return next.some((m) => m.direction === "inbound" && !known.has(m.id));
}
