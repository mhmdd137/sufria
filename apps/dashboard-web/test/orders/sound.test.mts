/**
 * What rings after a read of the live list (brief م-ب §7, tests 1–10), and
 * the polling that keeps reading with the tab hidden. `soundFor` is pure;
 * `startPolling` runs against a fake document and window.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OrderListItem } from "@sufria/shared";
import {
  ringTracker,
  soundFor,
  type LiveLists,
} from "../../features/orders/lib/live.ts";
import {
  startPolling,
  type PollingEnv,
} from "../../features/orders/hooks/use-polling.ts";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const minutes = (m: number) => new Date(NOW - m * 60_000).toISOString();

const order = (
  id: string,
  extra: Partial<OrderListItem> = {},
): OrderListItem => ({
  id,
  orderNumber: 1,
  status: "accepted",
  fulfillmentType: "pickup",
  total: "5.00",
  itemCount: 1,
  createdAt: minutes(10),
  customer: { name: null, phone: "+962790001234" },
  items: [],
  statusChangedAt: minutes(10),
  cancellationReason: null,
  unreadMessages: 0,
  lastMessage: null,
  staffMessagedAt: null,
  paymentMethod: "cash",
  paymentStatus: "pending_cash",
  ...extra,
});
const pending = (id: string, ageMinutes = 2) =>
  order(id, { status: "pending_acceptance", createdAt: minutes(ageMinutes) });
const lists = (
  orders: OrderListItem[],
  returned: OrderListItem[] = [],
): LiveLists => ({ orders, returned });

test("1. the first read, a pending order: order", () => {
  assert.equal(
    soundFor({
      prev: null,
      next: lists([pending("a")]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "order",
  );
});

test("2. the first read, unread messages: nothing — nothing to compare with", () => {
  assert.equal(
    soundFor({
      prev: null,
      next: lists(
        [order("a", { unreadMessages: 2 })],
        [order("r", { status: "cancelled", unreadMessages: 1 })],
      ),
      now: NOW,
      lastOrderRingAt: null,
    }),
    null,
  );
});

test("3. a new pending order: order", () => {
  assert.equal(
    soundFor({
      prev: lists([order("a")]),
      next: lists([order("a"), pending("b")]),
      now: NOW,
      lastOrderRingAt: NOW - 5_000,
    }),
    "order",
  );
});

test("🔴 4. the same pending order, 59 seconds after the last ring: nothing", () => {
  assert.equal(
    soundFor({
      prev: lists([pending("a")]),
      next: lists([pending("a")]),
      now: NOW,
      lastOrderRingAt: NOW - 59_000,
    }),
    null,
  );
});

test("5. the same, 60 seconds: order", () => {
  assert.equal(
    soundFor({
      prev: lists([pending("a")]),
      next: lists([pending("a")]),
      now: NOW,
      lastOrderRingAt: NOW - 60_000,
    }),
    "order",
  );
});

test("🔴 6. a pending order 3 hours and a minute old: nothing", () => {
  assert.equal(
    soundFor({
      prev: null,
      next: lists([pending("a", 181)]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    null,
  );
  assert.equal(
    soundFor({
      prev: lists([pending("a", 181)]),
      next: lists([pending("a", 181)]),
      now: NOW,
      lastOrderRingAt: NOW - 10 * 60_000,
    }),
    null,
  );
});

test("7. an order's unread count grew: message", () => {
  assert.equal(
    soundFor({
      prev: lists([order("a", { unreadMessages: 1 })]),
      next: lists([order("a", { unreadMessages: 2 })]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "message",
  );
});

test("8. down on one order, up on another: message", () => {
  assert.equal(
    soundFor({
      prev: lists([order("a", { unreadMessages: 3 }), order("b")]),
      next: lists([order("a"), order("b", { unreadMessages: 1 })]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "message",
  );
});

test("9. an order new to the returned group: message", () => {
  assert.equal(
    soundFor({
      prev: lists([order("a")]),
      next: lists(
        [order("a")],
        [order("r", { status: "completed", unreadMessages: 1 })],
      ),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "message",
  );
});

test("🔴 10. a message and a new order in the same read: order alone", () => {
  assert.equal(
    soundFor({
      prev: lists([order("a")]),
      next: lists([order("a", { unreadMessages: 1 }), pending("b")]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "order",
  );
});

test("a count that only went down, or stayed: nothing", () => {
  assert.equal(
    soundFor({
      prev: lists(
        [order("a", { unreadMessages: 2 })],
        [order("r", { unreadMessages: 1 })],
      ),
      next: lists([order("a", { unreadMessages: 2 })], []),
      now: NOW,
      lastOrderRingAt: null,
    }),
    null,
  );
});

test("ringTracker: an order ring each minute while it waits, and none once accepted", () => {
  const rings = ringTracker();
  assert.equal(rings.after(lists([pending("a")]), NOW), "order");
  assert.equal(rings.after(lists([pending("a")]), NOW + 10_000), null);
  assert.equal(rings.after(lists([pending("a")]), NOW + 60_000), "order");
  assert.equal(rings.after(lists([order("a")]), NOW + 130_000), null);
});

// --- polling with the tab hidden ---------------------------------------------

function fakeEnv() {
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let id = 0;
  const env = {
    document: {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    },
    window: {
      setInterval: (fn: () => void) => {
        timers.set(++id, fn);
        return id;
      },
      clearInterval: (t?: number) => {
        if (t !== undefined) timers.delete(t);
      },
    },
  };
  return {
    env: env as unknown as PollingEnv,
    hide() {
      env.document.visibilityState = "hidden";
      for (const l of listeners) l();
    },
    /** Every running interval fires once. */
    elapse() {
      for (const fn of [...timers.values()]) fn();
    },
    get running() {
      return timers.size;
    },
  };
}

test("usePolling, by default: hiding the tab stops it, as before", () => {
  const fake = fakeEnv();
  let ticks = 0;
  startPolling(() => ticks++, 10_000, {}, fake.env);
  assert.equal(ticks, 1, "at once");
  fake.hide();
  assert.equal(fake.running, 0);
  fake.elapse();
  assert.equal(ticks, 1);
});

test("usePolling with whileHidden: hiding the tab does not stop it", () => {
  const fake = fakeEnv();
  let ticks = 0;
  startPolling(() => ticks++, 10_000, { whileHidden: true }, fake.env);
  fake.hide();
  assert.equal(ticks, 1, "hiding reads nothing by itself");
  assert.equal(fake.running, 1);
  fake.elapse();
  assert.equal(ticks, 2);
});

// --- brief م-د, decision 12: a staff message stops a pending order's ring ---

test("a pending order staff wrote to: no order ring — on the first read, as new, or a minute on", () => {
  const written = order("p1", {
    status: "pending_acceptance",
    createdAt: minutes(2),
    staffMessagedAt: minutes(1),
  });
  assert.equal(
    soundFor({
      prev: null,
      next: lists([written]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    null,
  );
  assert.equal(
    soundFor({
      prev: lists([]),
      next: lists([written]),
      now: NOW,
      lastOrderRingAt: NOW - 120_000,
    }),
    null,
  );
  // Without it, as before: the order rings.
  assert.equal(
    soundFor({
      prev: lists([pending("p1")]),
      next: lists([pending("p1")]),
      now: NOW,
      lastOrderRingAt: NOW - 60_000,
    }),
    "order",
  );
  // Another pending order, unwritten, still rings.
  assert.equal(
    soundFor({
      prev: lists([written]),
      next: lists([written, pending("p2")]),
      now: NOW,
      lastOrderRingAt: NOW - 1_000,
    }),
    "order",
  );
});

test("a customer message on that order still rings its tick (م-ج, decision 14)", () => {
  const written = (unread: number) =>
    order("p1", {
      status: "pending_acceptance",
      createdAt: minutes(2),
      staffMessagedAt: minutes(1),
      unreadMessages: unread,
    });
  assert.equal(
    soundFor({
      prev: lists([written(0)]),
      next: lists([written(1)]),
      now: NOW,
      lastOrderRingAt: null,
    }),
    "message",
  );
});
