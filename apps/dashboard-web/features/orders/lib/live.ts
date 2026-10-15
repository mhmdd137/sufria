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
