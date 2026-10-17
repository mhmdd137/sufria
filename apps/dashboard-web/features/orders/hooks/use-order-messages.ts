"use client";

import { useCallback, useRef, useState } from "react";
import type { OrderMessage } from "@sufria/shared";
import { sound } from "../../../shared/sound/sound-store.ts";
import { ordersApi } from "../api/orders-api.ts";
import {
  MESSAGES_POLL_MS,
  newCustomerMessage,
  seenUpTo,
} from "../lib/details.ts";
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
 *
 * A read that brings a customer message the previous read did not have
 * rings, before the mark (brief م-ب-9 §2): marked read, the list would find
 * nothing to ring for. The first read after the page opens does not.
 */
export function useOrderMessages(
  id: string,
  reportOffline: (offline: boolean) => void,
  onSeen: () => void,
): { state: MessagesState; reload: () => Promise<void> } {
  const [state, setState] = useState<MessagesState>({ kind: "loading" });
  const marked = useRef<string | null>(null);
  const last = useRef<{
    id: string;
    messages: readonly OrderMessage[];
  } | null>(null);

  const reload = useCallback(async () => {
    const res = await ordersApi.orderMessages(id);
    if (res.ok) {
      const { messages } = res.value;
      setState({ kind: "ready", messages });
      const prev = last.current?.id === id ? last.current.messages : null;
      last.current = { id, messages };
      if (newCustomerMessage(prev, messages)) void sound.alert("message");
      const upTo = seenUpTo(messages, marked.current);
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
