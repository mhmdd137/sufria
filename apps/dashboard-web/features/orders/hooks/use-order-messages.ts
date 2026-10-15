"use client";

import { useCallback, useRef, useState } from "react";
import type { OrderMessage } from "@sufria/shared";
import { ordersApi } from "../api/orders-api.ts";
import { MESSAGES_POLL_MS, seenUpTo } from "../lib/details.ts";
import { usePolling } from "./use-polling.ts";

export type MessagesState =
  | { kind: "loading" }
  | { kind: "ready"; messages: OrderMessage[] }
  | { kind: "failed" };

/**
 * The order's conversation, read now and every 5 seconds while the tab is
 * visible (brief I §4, I-6; brief م-ب, decision 11). A failed read keeps
 * what was shown.
 *
 * Each read that brings a customer message newer than the last one marked
 * marks the order's messages read up to it, on the server (brief م-ب,
 * decision 12) — then `onSeen`: the list is read again at once, so the
 * card's bubble and the returned group follow without waiting for the
 * tick. A failed mark says nothing to the staff member; the next read tries
 * again.
 */
export function useOrderMessages(
  id: string,
  reportOffline: (offline: boolean) => void,
  onSeen: () => void,
): { state: MessagesState; reload: () => Promise<void> } {
  const [state, setState] = useState<MessagesState>({ kind: "loading" });
  const marked = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const res = await ordersApi.orderMessages(id);
    if (res.ok) {
      setState({ kind: "ready", messages: res.value.messages });
      const upTo = seenUpTo(res.value.messages, marked.current);
      if (upTo !== null) {
        const seen = await ordersApi.markMessagesSeen(id, upTo);
        if (seen.ok) {
          marked.current = upTo;
          onSeen();
        }
      }
      return;
    }
    // 401: the gate takes the page to login. 404: the order says so itself.
    if (res.error.kind === "unauthorized") return;
    if (res.error.kind === "network") reportOffline(true);
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
  }, [id, reportOffline, onSeen]);

  usePolling(() => void reload(), MESSAGES_POLL_MS);
  return { state, reload };
}
