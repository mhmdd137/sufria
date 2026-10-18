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
  afterSend,
  editInto,
  enterSends,
  fieldHeight,
  fieldOverflow,
  sendDecision,
} from "../lib/reply.ts";
import styles from "./staff-composer.module.css";

const R = DASHBOARD_REPLY_UI_AR;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

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
 * The field grows with its text up to 5 lines, then scrolls — no bar
 * before (brief م-د-9, decision 3). «أرسل» never takes the focus from it
 * — a press keeps the keyboard where it is — and is never disabled
 * (decision 7). On touch, once a text went, the cursor leaves the field:
 * the keyboard closes and the step's bar is back (brief م-د-9, decision 6).
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

  // Its height to its text, the CSS capping it at 5 lines; a bar only past
  // them (brief م-د-9) — inline, never in the CSS.
  useLayoutEffect(() => {
    const el = field.current;
    if (el === null) return;
    el.style.height = "auto";
    const frame = el.offsetHeight - el.clientHeight;
    el.style.height = `${fieldHeight(el.scrollHeight, frame)}px`;
    el.style.overflowY = fieldOverflow(
      el.scrollHeight + frame,
      parseFloat(getComputedStyle(el).maxHeight),
    );
  }, [draft]);

  function submit() {
    const decision = sendDecision(draft);
    if (decision.kind === "focus") {
      field.current?.focus();
      return;
    }
    setDraft("");
    onSend(decision.text);
    if (afterSend(matchMedia(FINE_POINTER).matches) === "blur")
      field.current?.blur();
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
              finePointer: matchMedia(FINE_POINTER).matches,
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
