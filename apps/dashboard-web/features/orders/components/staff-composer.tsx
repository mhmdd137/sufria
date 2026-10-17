"use client";

import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { DASHBOARD_REPLY_UI_AR } from "@sufria/shared";
import {
  FIELD_MAX_LENGTH,
  editInto,
  enterSends,
  sendDecision,
} from "../lib/reply.ts";
import styles from "./staff-composer.module.css";

const R = DASHBOARD_REPLY_UI_AR;

/** What the conversation does to the field: «عدّل وأرسل». */
export type ComposerHandle = { insert(text: string): void };

type Props = {
  /** A text `sendDecision` let through; the field is empty already. */
  onSend: (text: string) => void;
  handle: RefObject<ComposerHandle | null>;
};

/**
 * The field under the conversation (brief م-د §3). Its text is its own
 * state: typing redraws this form alone, never the messages (INP).
 *
 * The field grows with its text up to 5 lines, then scrolls. «أرسل» never
 * takes the focus from it — a press keeps the keyboard where it is — and
 * is never disabled (decision 7).
 */
export function StaffComposer({ onSend, handle }: Props) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    handle,
    () => ({
      insert(text) {
        setDraft((d) => editInto(d, text));
        field.current?.focus();
      },
    }),
    [],
  );

  // Its height to its text: the CSS caps it at 5 lines.
  useLayoutEffect(() => {
    const el = field.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [draft]);

  function submit() {
    const decision = sendDecision(draft);
    if (decision.kind === "focus") {
      field.current?.focus();
      return;
    }
    setDraft("");
    onSend(decision.text);
  }

  return (
    <form
      className={styles.composer}
      data-composer=""
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={field}
        className={styles.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (
            enterSends({
              key: e.key,
              shiftKey: e.shiftKey,
              isComposing: e.nativeEvent.isComposing,
              finePointer: matchMedia("(hover: hover) and (pointer: fine)")
                .matches,
            })
          ) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={R.placeholder}
        aria-label={R.placeholder}
        dir="auto"
        rows={1}
        maxLength={FIELD_MAX_LENGTH}
      />
      <button
        type="submit"
        className={styles.send}
        onMouseDown={(e) => e.preventDefault()}
      >
        {R.send}
      </button>
    </form>
  );
}
