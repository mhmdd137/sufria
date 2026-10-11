"use client";

import { useCallback, useState } from "react";
import {
  DASHBOARD_MENU_UI_AR,
  DASHBOARD_UI_AR,
  enableAllBodyAr,
  offCountAr,
  removeTitleAr,
  type MenuItemListItem,
} from "@sufria/shared";
import { useLiveSettings } from "../../../shared/settings/live-settings.tsx";
import { Skeleton } from "../../../shared/ui/skeleton.tsx";
import { menuApi } from "../api/menu-api.ts";
import { useMenu } from "../hooks/use-menu.ts";
import {
  byCategory,
  itemErrorLine,
  menuErrorLine,
  offCount,
} from "../lib/menu.ts";
import { AddItemForm } from "./add-item-form.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { MenuRow } from "./menu-row.tsx";
import { MenuTabs } from "./menu-tabs.tsx";
import { PauseBox } from "./pause-box.tsx";
import styles from "./menu-screen.module.css";

const T = DASHBOARD_UI_AR;
const M = DASHBOARD_MENU_UI_AR;

/** One of the screen's two confirmations, open. */
type Asking =
  | { kind: "remove"; item: MenuItemListItem }
  | { kind: "enableAll"; count: number };

/**
 * «المنيو» (brief ي-ب §6): the pause box above the two tabs (brief ي-ب-9
 * §4.3), «أضف صنفا», «المطفأة» and «شغّل الكل» while any is off, and the
 * menu under its categories in the customer's order, an item switched off
 * keeping its place. No menu numbers: the bot's change with every
 * switch-off.
 */
export function MenuScreen() {
  const { currency } = useLiveSettings();
  const menu = useMenu();
  const { update, drop, reload } = menu;
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [askLine, setAskLine] = useState<string | null>(null);

  const askRemove = useCallback((item: MenuItemListItem) => {
    setAskLine(null);
    setAsking({ kind: "remove", item });
  }, []);

  async function confirm() {
    if (!asking) return;
    setConfirming(true);
    setAskLine(null);
    if (asking.kind === "remove") {
      const res = await menuApi.updateItem(asking.item.id, { archived: true });
      setConfirming(false);
      if (!res.ok) return setAskLine(itemErrorLine(res.error));
      drop(asking.item.id);
    } else {
      const res = await menuApi.enableAll();
      setConfirming(false);
      if (!res.ok) return setAskLine(menuErrorLine(res.error));
      await reload();
    }
    setAsking(null);
  }

  const ready = menu.state.kind === "ready" && currency !== null;
  const items = menu.state.kind === "ready" ? menu.state.items : [];
  const categories = menu.state.kind === "ready" ? menu.state.categories : [];
  const off = offCount(items);
  const canAdd = !adding && categories.length > 0;

  return (
    <main className={styles.page}>
      <h1 className="visually-hidden">{T.tabs.menu}</h1>
      <PauseBox />
      <MenuTabs current="items" />

      {ready && (canAdd || off > 0) && (
        <div className={styles.tools}>
          {canAdd && (
            <button
              type="button"
              className={`${styles.primary} ${styles.add}`}
              onClick={() => setAdding(true)}
            >
              {M.add}
            </button>
          )}
          {off > 0 && (
            <div className={styles.off}>
              <span className={`num ${styles.offCount}`}>
                {offCountAr(off)}
              </span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setAskLine(null);
                  setAsking({ kind: "enableAll", count: off });
                }}
              >
                {M.enableAll}
              </button>
            </div>
          )}
        </div>
      )}

      {ready && adding && (
        <AddItemForm
          categories={categories}
          onAdded={() => {
            setAdding(false);
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {(menu.state.kind === "loading" ||
        (menu.state.kind === "ready" && currency === null)) && (
        <Skeleton lines={5} />
      )}

      {menu.state.kind === "failed" && (
        <div className={styles.failed}>
          <p className={styles.notice}>{T.errors.loadFailed}</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void reload()}
          >
            {T.errors.retry}
          </button>
        </div>
      )}

      {ready && items.length === 0 && (
        <p className={styles.empty}>{M.empty.items}</p>
      )}

      {ready &&
        byCategory(items).map((group) => (
          <section
            key={group.id}
            className={styles.category}
            aria-labelledby={`category-${group.id}`}
          >
            <h2 id={`category-${group.id}`} className={styles.heading}>
              {group.name}
            </h2>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <MenuRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  onChanged={update}
                  onRemove={askRemove}
                />
              ))}
            </ul>
          </section>
        ))}

      <ConfirmDialog
        open={asking !== null}
        title={
          asking?.kind === "remove"
            ? removeTitleAr(asking.item.name)
            : M.enableAllTitle
        }
        body={
          asking?.kind === "enableAll"
            ? enableAllBodyAr(asking.count)
            : M.removeBody
        }
        confirm={asking?.kind === "enableAll" ? M.enableAll : M.removeConfirm}
        busy={confirming}
        line={askLine}
        onConfirm={() => void confirm()}
        onClose={() => setAsking(null)}
      />
    </main>
  );
}
