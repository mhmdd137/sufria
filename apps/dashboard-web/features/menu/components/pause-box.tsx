"use client";

import { useState } from "react";
import { DASHBOARD_MENU_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { ordersPauseApi } from "../api/orders-pause-api.ts";
import { PauseIcon } from "./pause-icon.tsx";
import screen from "./menu-screen.module.css";
import styles from "./pause-box.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MENU_UI_AR;

/**
 * «أوقف الطلبات مؤقتا» and what every customer then gets, a bar of its own
 * right under the header on the two menu pages (brief ل §4.1, decision 1;
 * a box above the tabs since brief ي-ب-9 §4.3): it stops the whole
 * restaurant, so it is not one of the menu's tools. Gone while paused —
 * the amber strip shows in its place (decision 3: its «استأنف» is then
 * the one button) — and before the first read. No dialog: the press
 * sends, and the answer shows the strip.
 */
export function PauseBox() {
  const { ordersPausedAt, pauseChanged } = useLiveSettings();
  const [pausing, setPausing] = useState(false);
  const [failed, setFailed] = useState(false);
  if (ordersPausedAt !== null) return null;

  async function pause() {
    setPausing(true);
    setFailed(false);
    const res = await ordersPauseApi.setPaused(true);
    setPausing(false);
    // The strip shows at once, from the answer; this box goes with it.
    if (res.ok) pauseChanged(res.value.ordersPausedAt);
    // `unauthorized`: the gate takes the page to login.
    else if (res.error.kind !== "unauthorized") setFailed(true);
  }

  return (
    <div className={styles.bar}>
      <div className={styles.box}>
        <button
          type="button"
          className={`${screen.secondary} ${styles.button}`}
          onClick={pause}
          disabled={pausing}
          aria-busy={pausing}
        >
          <PauseIcon />
          {M.pause}
        </button>
        {/* The customer's message drops whole to a line of its own. */}
        <p className={styles.hint}>
          {M.pauseHintLead} <span>{M.pauseHintQuote}</span>
        </p>
        {failed && (
          <p className={styles.line} role="status">
            {T.errors.stepFailed}
          </p>
        )}
      </div>
    </div>
  );
}
