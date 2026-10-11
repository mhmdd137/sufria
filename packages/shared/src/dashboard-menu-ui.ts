/**
 * The menu screen's text — brief ي-ب, Mohammed's texts of 10 October,
 * verbatim. Shown on `/menu` and `/menu/removed` alone, so a file of its own
 * (brief ي-ب-9 §3, decision 2B): `DASHBOARD_UI_AR` is one object, and every
 * page carries all of it. What every page shows stays there — `tabs.menu`,
 * `paused` and `ordersPausedAr`: the tab and the pause strip.
 *
 * The same pattern as `dashboard-ui.ts`: one exported dictionary, its exact
 * wording held by a test, and `check:numerals` walking every string in it.
 */
import { COUNT_SLOT } from "./dashboard-ui.js";
import { ITEM_NAME_SLOT, ORDERS_PAUSED_AR } from "./domain.js";

/** The first message's length in «menu too long» (brief ي-ب, text 17). */
export const LENGTH_SLOT = "[الطول]";

/**
 * «رجوع» in its two dialogs is `DASHBOARD_UI_AR.cancel.back`; a failed
 * action is `DASHBOARD_UI_AR.errors.stepFailed`.
 */
export const DASHBOARD_MENU_UI_AR = {
  /** The screen's two tabs (decision 4). */
  tabs: { items: "الأصناف", removed: "المُزالة" },
  add: "أضف صنفا",
  pause: "أوقف الطلبات مؤقتا",
  /**
   * Under «أوقف الطلبات مؤقتا»: what every customer then receives — built
   * from `ORDERS_PAUSED_AR` itself, never a copy of it.
   */
  pauseHint: `يتلقى كل من يراسلك: «${ORDERS_PAUSED_AR}»`,
  /** With «شغّل الكل», while the count is over 0. */
  offCount: `المطفأة: ${COUNT_SLOT}`,
  enableAll: "شغّل الكل",
  /** «شغّل الكل»'s dialog: its buttons are `enableAll` and `cancel.back`. */
  enableAllTitle: "شغّل الأصناف المطفأة؟",
  enableAllBody: `عددها ${COUNT_SLOT}، وستظهر في منيو واتساب.`,
  /** An item's state, in a word — never by colour alone. */
  status: { available: "متاح", off: "مطفأ" },
  turnOff: "أطفئ",
  turnOn: "شغّل",
  edit: "تعديل",
  remove: "إزالة",
  /** The labels of the row's fields and of the add form's. */
  fields: { category: "التصنيف", name: "الاسم", price: "السعر" },
  save: "حفظ",
  cancel: "إلغاء",
  /** On a row in edit whose fields differ from what is saved. */
  unsaved: "لم يُحفظ",
  /** The add form's button. */
  addSubmit: "أضف",
  /** The removal dialog: its buttons are `removeConfirm` and `cancel.back`. */
  removeTitle: `إزالة ${ITEM_NAME_SLOT} من المنيو؟`,
  removeBody: "لن يظهر للزبائن، وتجده في «المُزالة» إن أردت إرجاعه.",
  removeConfirm: "أزِله",
  /** «المُزالة»'s button, and the line after it. */
  restore: "إرجاع",
  restored: `رجع ${ITEM_NAME_SLOT} إلى «الأصناف» مطفأ. شغّله من هناك ليظهر للزبائن.`,
  empty: {
    items: "لا أصناف في المنيو بعد.",
    removed: "الأصناف التي تزيلها من المنيو تظهر هنا، ويمكنك إرجاعها.",
  },
  errors: {
    nameEmpty: "اكتب اسم الصنف.",
    /** The 40 is `MENU_ITEM_NAME_MAX`, written out; a test binds them. */
    nameTooLong: "الاسم أطول من 40 حرفا.",
    priceInvalid: "اكتب سعرا صحيحا، مثل 2.50.",
    /**
     * 409 `menu_too_long`. The 4096 is `WHATSAPP_TEXT_LIMIT`, written
     * out; a test binds them.
     */
    tooLong: `لن يتسع المنيو في رسالة واتساب واحدة: سيصبح ${LENGTH_SLOT} حرفا والحد 4096. اختصر اسما أو أزل صنفا.`,
    /** 409 `item_archived`, and a 404 on an item. */
    archived: "أُزيل هذا الصنف من جهاز آخر.",
  },
} as const;

/**
 * One pass: a value that itself holds «[..]» is never scanned again — the
 * same as `dashboard-ui.ts`'s, private to each file like `domain.ts`'s.
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\[[^\]]+\]/gu, (slot) => values[slot] ?? slot);
}

/** «المطفأة: 3» — beside «شغّل الكل» (brief ي-ب, text 6). */
export function offCountAr(count: number): string {
  return fill(DASHBOARD_MENU_UI_AR.offCount, { [COUNT_SLOT]: String(count) });
}

/** «عددها 3، وستظهر في منيو واتساب.» — «شغّل الكل»'s dialog (text 7). */
export function enableAllBodyAr(count: number): string {
  return fill(DASHBOARD_MENU_UI_AR.enableAllBody, {
    [COUNT_SLOT]: String(count),
  });
}

/** «إزالة شاورما دجاج من المنيو؟» — the removal dialog's title (text 12). */
export function removeTitleAr(name: string): string {
  return fill(DASHBOARD_MENU_UI_AR.removeTitle, { [ITEM_NAME_SLOT]: name });
}

/** The line after «إرجاع» (text 14). */
export function restoredLineAr(name: string): string {
  return fill(DASHBOARD_MENU_UI_AR.restored, { [ITEM_NAME_SLOT]: name });
}

/** A 409 `menu_too_long`, with the length the API answered (text 17). */
export function menuTooLongAr(length: number): string {
  return fill(DASHBOARD_MENU_UI_AR.errors.tooLong, {
    [LENGTH_SLOT]: String(length),
  });
}
