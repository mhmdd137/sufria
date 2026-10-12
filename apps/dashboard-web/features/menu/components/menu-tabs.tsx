import Link from "next/link";
import { DASHBOARD_MENU_UI_AR } from "@sufria/shared";
import styles from "./menu-tabs.module.css";

const M = DASHBOARD_MENU_UI_AR;

/**
 * «الأصناف» and «المُزالة» — the menu screen's two views (decision 4):
 * links, the current one marked `aria-current="page"`, drawn as a view
 * switch since brief ل §4.2 (decision 5) — no longer the header's tabs'
 * look, which made neither the main one.
 */
export function MenuTabs({ current }: { current: "items" | "removed" }) {
  return (
    <nav className={styles.tabs}>
      <Link
        href="/menu"
        className={styles.tab}
        aria-current={current === "items" ? "page" : undefined}
      >
        {M.tabs.items}
      </Link>
      <Link
        href="/menu/removed"
        className={styles.tab}
        aria-current={current === "removed" ? "page" : undefined}
      >
        {M.tabs.removed}
      </Link>
    </nav>
  );
}
