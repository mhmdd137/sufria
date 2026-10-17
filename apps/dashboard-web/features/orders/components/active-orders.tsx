"use client";

import { useCallback } from "react";
import { DASHBOARD_MESSAGES_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { useLiveOrders } from "../hooks/live-orders.tsx";
import type { AdvanceOutcome } from "../lib/board.ts";
import { OrderCard } from "./order-card.tsx";
import styles from "./order-list.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MESSAGES_UI_AR;

/**
 * «الطلبات» (brief G §3, G-4): the live list of the dashboard's one poll,
 * oldest first, each card with its next step. Above it, while there are
 * any, the closed orders a customer's message brought back, under their
 * title (brief م-ب, decision 3): not inside the queue — «ملغى» beside
 * «معلّق» in dark differ by too little to tell apart at a glance.
 */
export function ActiveOrders() {
  const live = useLiveOrders();
  const { apply, refresh } = live;

  // `unauthorized`: the session is gone, and the gate takes the page to login.
  const onOutcome = useCallback(
    (outcome: AdvanceOutcome) => {
      if (outcome.kind === "changed") apply(outcome.order);
      if (outcome.kind === "refresh") void refresh();
    },
    [apply, refresh],
  );

  const { orders, returned, currency, now } = live;
  return (
    <main className={styles.list}>
      <h1 className="visually-hidden">{T.tabs.active}</h1>
      {returned && currency && returned.length > 0 && (
        <section className={styles.returned} aria-labelledby="returned-title">
          <h2 id="returned-title" className={styles.groupTitle}>
            {M.returned}
          </h2>
          {returned.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              place="returned"
              currency={currency}
              now={now}
              onOutcome={onOutcome}
            />
          ))}
        </section>
      )}
      {orders && currency && orders.length === 0 && (
        <p className={styles.empty}>{T.empty.active}</p>
      )}
      {orders &&
        currency &&
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            place="active"
            currency={currency}
            now={now}
            onOutcome={onOutcome}
          />
        ))}
    </main>
  );
}
