"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_MESSAGES_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import type { MessagesState } from "../hooks/use-order-messages.ts";
import { conversationView } from "../lib/details.ts";
import { withLocal, type LocalStaffMessage } from "../lib/reply.ts";
import styles from "./conversation.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MESSAGES_UI_AR;

type Props = {
  state: MessagesState;
  retry: () => void;
  /** «راسل الزبون»: `https://wa.me/<digits>`, the order's own link. */
  chat: string;
  /** The staff messages this page sent that no read brought back yet. */
  local: readonly LocalStaffMessage[];
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
 *
 * A staff member's message is at the bot's end (brief م-د §3): a dashed
 * line while it goes, filled once it reached the customer, a thick line
 * with nothing in it when it failed — and under it, their name and the
 * time, «جارٍ الإرسال…», or why.
 */
export function Conversation({ state, retry, chat, local }: Props) {
  const view = useMemo(
    () =>
      state.kind === "ready"
        ? conversationView(
            withLocal(state.messages, local),
            state.replyOpenUntil !== null,
          )
        : null,
    [state, local],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLOListElement>(null);
  const opened = useRef(false);
  // Whether the list was at its end before the next answer (48px slack).
  const atEnd = useRef(true);

  // The latest message in sight: on the first answer, and on every answer
  // after while the staff member was at the end — never when they scrolled
  // up to read (brief م-ب, 17 October).
  useEffect(() => {
    if (view === null || list.current === null) return;
    if (opened.current && !atEnd.current) return;
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
        <ol
          ref={list}
          className={styles.messages}
          onScroll={(e) => {
            const el = e.currentTarget;
            atEnd.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {view.messages.map((m) => {
            const open = expanded.has(m.id);
            return (
              <li
                key={m.id}
                className={styles.message}
                data-from={m.from}
                data-state={m.staff?.state}
              >
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
                {m.staff?.meta && (
                  <span className={styles.meta}>
                    {m.staff.meta.before}
                    <span className={`num ${styles.metaTime}`}>
                      {m.staff.meta.time}
                    </span>
                    {m.staff.meta.after}
                  </span>
                )}
                {m.staff?.state === "pending" && (
                  <span className={styles.meta}>{m.staff.note}</span>
                )}
                {m.staff?.state === "failed" && (
                  <div className={styles.failure}>
                    <span className={styles.reason}>{m.staff.note}</span>
                    {m.staff.action === "contact" && (
                      <a
                        className={styles.action}
                        href={chat}
                        target="_blank"
                        rel="noopener"
                      >
                        {T.details.messageCustomer}
                      </a>
                    )}
                  </div>
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
                {m.staff === null && (
                  <span className={`num ${styles.time}`}>{m.time}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
