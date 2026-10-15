"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_MESSAGES_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import type { MessagesState } from "../hooks/use-order-messages.ts";
import { conversationView } from "../lib/details.ts";
import styles from "./conversation.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MESSAGES_UI_AR;

type Props = {
  state: MessagesState;
  retry: () => void;
};

/**
 * «المحادثة» (brief I §4, I-6): the customer's messages at the start of the
 * line, the bot's at its end, each as it was written — `dir="auto"`, its
 * lines kept. From 1024px up the list scrolls by itself, opening on the last
 * message; below, it is part of the page.
 *
 * A customer message with no text is its kind's word in the same bubble, in
 * grey (brief م-ب): «رسالة صوتية — لا تظهر هنا», and a location «موقع» with
 * «افتح الخريطة» after it, in a new tab.
 */
export function Conversation({ state, retry }: Props) {
  const view = useMemo(
    () => (state.kind === "ready" ? conversationView(state.messages) : null),
    [state],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLOListElement>(null);
  const opened = useRef(false);

  // Once, on the first answer: the latest message in sight.
  useEffect(() => {
    if (view === null || opened.current || list.current === null) return;
    list.current.scrollTop = list.current.scrollHeight;
    opened.current = true;
  }, [view]);

  function toggle(id: string) {
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <section className={styles.chat} aria-labelledby="conversation-title">
      <h2 id="conversation-title" className={styles.title}>
        {T.conversation.title}
      </h2>

      {state.kind === "loading" && <Skeleton lines={4} />}

      {state.kind === "failed" && (
        <div className={styles.failed}>
          <p>{T.errors.loadFailed}</p>
          <button type="button" className={styles.retry} onClick={retry}>
            {T.errors.retry}
          </button>
        </div>
      )}

      {view?.notice && <p className={styles.notice}>{view.notice}</p>}

      {view && view.messages.length > 0 && (
        <ol ref={list} className={styles.messages}>
          {view.messages.map((m) => {
            const open = expanded.has(m.id);
            return (
              <li key={m.id} className={styles.message} data-from={m.from}>
                {m.word !== null ? (
                  <p className={`${styles.bubble} ${styles.word}`}>
                    <span>{m.word}</span>
                    {m.map !== null && (
                      <a
                        href={m.map}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.map}
                      >
                        {M.openMap}
                      </a>
                    )}
                  </p>
                ) : (
                  <p className={styles.bubble} dir="auto">
                    {m.preview !== null && !open ? m.preview : m.text}
                  </p>
                )}
                {m.preview !== null && (
                  <button
                    type="button"
                    className={styles.more}
                    aria-expanded={open}
                    onClick={() => toggle(m.id)}
                  >
                    {open ? T.conversation.hide : T.conversation.showAll}
                  </button>
                )}
                <span className={`num ${styles.time}`}>{m.time}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
