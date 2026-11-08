"use client";

import { useSyncExternalStore } from "react";
import { THEME_ATTRIBUTE } from "@sufria/shared";
import {
  currentMode,
  otherMode,
  storeTheme,
  themeButtonLabel,
  type ThemeMode,
} from "./theme.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const changed = new Set<() => void>();

function subscribe(listener: () => void) {
  // No choice kept: the device's setting changing changes the word too.
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  changed.add(listener);
  return () => {
    media.removeEventListener("change", listener);
    changed.delete(listener);
  };
}

function snapshot(): ThemeMode {
  return currentMode(
    document.documentElement.getAttribute(THEME_ATTRIBUTE),
    window.matchMedia(DARK_QUERY).matches,
  );
}

/**
 * The colours change at once — no transition (§5.8): for the one style
 * change, a sheet that stops every transition, taken away after it.
 */
function apply(mode: ThemeMode) {
  const stop = document.createElement("style");
  stop.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(stop);
  document.documentElement.setAttribute(THEME_ATTRIBUTE, mode);
  void window.getComputedStyle(document.body).color;
  window.setTimeout(() => stop.remove(), 1);
  storeTheme(() => window.localStorage, mode);
  for (const l of changed) l();
}

type Props = { className: string };

/**
 * The header's light and dark button (brief م-هـ-ب §5.8, decisions 9–11):
 * the sound button's look (`className` is the header's `.logout`), its word
 * the mode it takes you to; no `aria-pressed` — the name changes with it.
 *
 * The header is drawn in the browser alone, once the session is read
 * (`SessionGate`: nothing on the server), so the mode is known at its first
 * render: no hydration mismatch, nothing that moves after. The server's
 * snapshot is never shown.
 */
export function ThemeButton({ className }: Props) {
  const mode = useSyncExternalStore(
    subscribe,
    snapshot,
    (): ThemeMode => "light",
  );
  return (
    <button
      type="button"
      className={className}
      onClick={() => apply(otherMode(mode))}
    >
      {themeButtonLabel(mode)}
    </button>
  );
}
