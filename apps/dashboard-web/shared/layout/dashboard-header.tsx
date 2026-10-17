"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_SOUND_UI_AR, DASHBOARD_UI_AR } from "@sufria/shared";
import { sound } from "../sound/sound-store.ts";
import { useSound } from "../sound/use-sound.ts";
import { BrandMark } from "../ui/brand-mark.tsx";
import styles from "./dashboard-header.module.css";
import { isCurrentTab } from "./tabs.ts";

const T = DASHBOARD_UI_AR;
const S = DASHBOARD_SOUND_UI_AR;

type Props = {
  restaurantName: string;
  /** The number on «الطلبات»; `null` until the first poll answers. */
  activeCount: number | null;
  /** The last read failed: the strip under the header. */
  offline: boolean;
  onLogout: () => void;
  /**
   * Under the header, above «انقطع الاتصال» when both show: the pause strip
   * (brief ي-ب §5), from the layout.
   */
  strip?: ReactNode;
};

/**
 * The dashboard's header on every page behind login (brief G §3 G-4, brief I
 * §4 I-3), two lines since brief ل §5.1 (addition 2): the mark, the
 * restaurant's name, «مباشر», the sound's button (brief م-ب, decision 9:
 * logout's look, before it; the name is cut first on a phone) and logout —
 * «سُفريا» stays on the login page
 * and the browser's tab — then the three tabs — links, the current one marked `aria-current="page"`
 * (`isCurrentTab`: «المنيو» on /menu and /menu/removed, brief ي-ب §5) — then
 * the pause strip, and the strip while the connection is down.
 *
 * The restaurant's name keeps its place and size but is not the page's
 * `<h1>`: each page has its own.
 */
export function DashboardHeader({
  restaurantName,
  activeCount,
  offline,
  onLogout,
  strip,
}: Props) {
  const pathname = usePathname();
  const { muted } = useSound();
  const current = (href: string) =>
    isCurrentTab(pathname, href) ? "page" : undefined;

  return (
    <>
      <header className={styles.top}>
        {/* The page's width and edges; the background is the screen's. */}
        <div className={`${styles.bounds} ${styles.content}`}>
          <div className={styles.topRow}>
            <BrandMark />
            <span className={styles.title}>{restaurantName}</span>
            <span className={styles.live}>
              <span className={styles.liveDot} aria-hidden="true" />
              {T.live}
            </span>
            <button
              type="button"
              className={styles.logout}
              onClick={() => sound.setMuted(!muted)}
            >
              {muted ? S.unmute : S.mute}
            </button>
            <button type="button" className={styles.logout} onClick={onLogout}>
              {T.logout}
            </button>
          </div>
          <nav className={styles.tabs}>
            <Link
              href="/orders"
              className={styles.tab}
              aria-current={current("/orders")}
            >
              {T.tabs.active}
              {activeCount !== null && (
                <span className={`num ${styles.count}`}>{activeCount}</span>
              )}
            </Link>
            <Link
              href="/history"
              className={styles.tab}
              aria-current={current("/history")}
            >
              {T.tabs.history}
            </Link>
            <Link
              href="/menu"
              className={styles.tab}
              aria-current={current("/menu")}
            >
              {T.tabs.menu}
            </Link>
          </nav>
        </div>
      </header>

      {strip}

      {offline && (
        <div className={styles.offline} role="status">
          <div className={styles.bounds}>{T.errors.disconnected}</div>
        </div>
      )}
    </>
  );
}
