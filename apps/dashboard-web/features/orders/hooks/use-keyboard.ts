"use client";

import { useEffect, type RefObject } from "react";
import { keyboardOpen } from "../lib/reply.ts";

/**
 * `data-keyboard` on `ref` while the phone's keyboard is open over the
 * field (brief م-د-9, decision 5: `keyboardOpen`) — the CSS then puts the
 * step's bar back in the page. Read again when the visual viewport resizes
 * (the keyboard opening or closing, the back button included) and when the
 * focus comes into or leaves the page. Written on the element itself:
 * nothing redraws. With no `visualViewport`, never.
 */
export function useKeyboard(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const viewport = window.visualViewport;
    if (el === null || !viewport) return;
    const update = () => {
      const focused = document.activeElement;
      el.toggleAttribute(
        "data-keyboard",
        keyboardOpen({
          focused:
            focused instanceof HTMLTextAreaElement &&
            el.contains(focused) &&
            focused.closest("[data-composer]") !== null,
          innerHeight: window.innerHeight,
          viewportHeight: viewport.height,
          scale: viewport.scale,
        }),
      );
    };
    update();
    viewport.addEventListener("resize", update);
    el.addEventListener("focusin", update);
    el.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      el.removeEventListener("focusin", update);
      el.removeEventListener("focusout", update);
      el.removeAttribute("data-keyboard");
    };
  }, [ref]);
}
