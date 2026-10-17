/**
 * The live list's own decisions (brief I §4, I-3), apart from the cards':
 * the dashboard's one poll, in the layout of every page, imports this file
 * alone — `board.ts`, with every card decision and its texts, stays on the
 * pages that show cards (brief م-ب, the size budget).
 */
import { ORDER_TAB_STATUSES, type OrderListItem } from "@sufria/shared";

/** The active tab polls every 10 seconds (ADR-003: 10 to 15). */
export const POLL_MS = 10_000;

/**
 * The active list after a card changed: the order in place, or gone once its
 * status belongs to history (`completed`).
 */
export function replaceInActive(
  orders: readonly OrderListItem[],
  changed: OrderListItem,
): OrderListItem[] {
  const stays = ORDER_TAB_STATUSES.active.includes(changed.status);
  return orders.flatMap((o) =>
    o.id !== changed.id ? [o] : stays ? [changed] : [],
  );
}

/** A sound the board rings (brief م-ب, decision 5): O2 or M1. */
export type BoardSound = "order" | "message";

/** A pending order rings again every minute until accepted (decision 6)… */
export const ORDER_RING_EVERY_MS = 60_000;
/** …while it is younger than three hours. */
export const ORDER_RING_FOR_MS = 3 * 60 * 60_000;

/** One answer of the live list: «الطلبات» and the returned group. */
export type LiveLists = {
  orders: readonly OrderListItem[];
  returned: readonly OrderListItem[];
};

/**
 * What rings after a read of the live list (brief م-ب):
 * - `order`: a pending order younger than three hours, and one of them new
 *   since the read before, or a minute since the last order ring;
 * - `message`: an order — on its way or returned — with more unread than the
 *   read before, or a returned order new to the group. Once per read,
 *   however many (decision 7);
 * - both at once: `order` alone — it matters more, and the tick is lost
 *   under it;
 * - the first read after the page opens (`prev` null): `order` for a
 *   pending order, never `message` — nothing to compare with.
 * `now` and `createdAt` are compared on the browser's clock.
 */
export function soundFor({
  prev,
  next,
  now,
  lastOrderRingAt,
}: {
  prev: LiveLists | null;
  next: LiveLists;
  now: number;
  lastOrderRingAt: number | null;
}): BoardSound | null {
  const waiting = next.orders.filter(
    (o) =>
      o.status === "pending_acceptance" &&
      now - Date.parse(o.createdAt) < ORDER_RING_FOR_MS,
  );
  if (waiting.length > 0) {
    if (prev === null) return "order";
    const before = new Set(prev.orders.map((o) => o.id));
    if (
      waiting.some((o) => !before.has(o.id)) ||
      lastOrderRingAt === null ||
      now - lastOrderRingAt >= ORDER_RING_EVERY_MS
    )
      return "order";
  }
  if (prev === null) return null;

  const counts = new Map(
    [...prev.orders, ...prev.returned].map((o) => [o.id, o.unreadMessages]),
  );
  const wasReturned = new Set(prev.returned.map((o) => o.id));
  const more = [...next.orders, ...next.returned].some(
    (o) => o.unreadMessages > (counts.get(o.id) ?? 0),
  );
  const back = next.returned.some((o) => !wasReturned.has(o.id));
  return more || back ? "message" : null;
}

/**
 * `soundFor` across reads: remembers the read before and the last order
 * ring. One per live list, for its life.
 */
export function ringTracker(): {
  after(next: LiveLists, now: number): BoardSound | null;
} {
  let prev: LiveLists | null = null;
  let lastOrderRingAt: number | null = null;
  return {
    after(next, now) {
      const ring = soundFor({ prev, next, now, lastOrderRingAt });
      prev = next;
      if (ring === "order") lastOrderRingAt = now;
      return ring;
    },
  };
}
