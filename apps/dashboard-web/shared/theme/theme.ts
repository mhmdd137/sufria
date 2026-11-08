/**
 * The light and dark choice (brief م-هـ-ب §9ب, Mohammed's decisions 9–11,
 * 8 November): before any press, the device's setting, as before; after
 * one, the choice is kept on this device (`localStorage`, one key) and wins
 * over it. Never in the API, never in the account (decision 11).
 *
 * Pure, apart from the browser: the header's button and the script before
 * the first paint are built on these.
 */
import { DASHBOARD_UI_AR, THEME_ATTRIBUTE } from "@sufria/shared";

export type ThemeMode = "light" | "dark";

/** The one key in `localStorage`. */
export const THEME_KEY = "sufria-theme";

/** `light` or `dark`; anything else is no choice. */
export function parseTheme(value: unknown): ThemeMode | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The stored choice — `null` when there is none, or storage refuses. */
export function readStoredTheme(
  storage: () => Pick<Storage, "getItem"> | null,
): ThemeMode | null {
  try {
    return parseTheme(storage()?.getItem(THEME_KEY));
  } catch {
    return null;
  }
}

/** Kept on this device; `false` when storage refused (this page alone). */
export function storeTheme(
  storage: () => Pick<Storage, "setItem"> | null,
  mode: ThemeMode,
): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(THEME_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** The page's mode: the choice on `<html>`, else the device's setting. */
export function currentMode(
  attribute: string | null | undefined,
  deviceDark: boolean,
): ThemeMode {
  return parseTheme(attribute) ?? (deviceDark ? "dark" : "light");
}

/** What a press makes it. */
export function otherMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}

/** The button's word: the mode it takes you to (decision 10). */
export function themeButtonLabel(mode: ThemeMode): string {
  return DASHBOARD_UI_AR.theme[otherMode(mode)];
}

/**
 * The script at the top of `<head>`, before any stylesheet applies and
 * before the first paint: the stored choice on `<html>`, `light` or `dark`
 * alone, all of it inside `try` — storage can be refused. Without it, a
 * choice that differs from the device would show the wrong mode for a
 * moment, then turn.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t)}catch(e){}})();`;
