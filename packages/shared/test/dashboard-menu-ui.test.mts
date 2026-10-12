/**
 * The menu screen's dictionary and its texts with a slot — brief ي-ب, held
 * verbatim, in a file of their own since brief ي-ب-9 §3 (decision 2B): the
 * same words, moved out of `DASHBOARD_UI_AR`, which every page carries.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_MENU_UI_AR,
  LENGTH_SLOT,
  MENU_ITEM_NAME_MAX,
  ORDERS_PAUSED_AR,
  WHATSAPP_TEXT_LIMIT,
  enableAllBodyAr,
  menuTooLongAr,
  offCountAr,
  removeTitleAr,
  restoredLineAr,
} from "@sufria/shared";

test("DASHBOARD_MENU_UI_AR is the brief's text, verbatim", () => {
  // Brief ي-ب, verbatim (Mohammed, 10 October).
  assert.deepEqual(DASHBOARD_MENU_UI_AR, {
    tabs: { items: "الأصناف", removed: "المُزالة" },
    add: "أضف صنفا",
    pause: "أوقف الطلبات مؤقتا",
    pauseHintLead: "يتلقى كل من يراسلك:",
    pauseHintQuote: "«أوقفنا استقبال الطلبات مؤقتا. راسلنا لاحقا.»",
    offCount: "المطفأة: [العدد]",
    enableAll: "شغّل الكل",
    enableAllTitle: "شغّل الأصناف المطفأة؟",
    enableAllBody: "عددها [العدد]، وستظهر في منيو واتساب.",
    status: { available: "متاح", off: "مطفأ" },
    turnOff: "أطفئ",
    turnOn: "شغّل",
    edit: "تعديل",
    remove: "إزالة",
    fields: { category: "التصنيف", name: "الاسم", price: "السعر" },
    save: "حفظ",
    cancel: "إلغاء",
    unsaved: "لم يُحفظ",
    addSubmit: "أضف",
    removeTitle: "إزالة [الاسم] من المنيو؟",
    removeBody: "لن يظهر للزبائن، وتجده في «المُزالة» إن أردت إرجاعه.",
    removeConfirm: "أزِله",
    restore: "إرجاع",
    restored: "رجع [الاسم] إلى «الأصناف» مطفأ. شغّله من هناك ليظهر للزبائن.",
    empty: {
      items: "لا أصناف في المنيو بعد.",
      removed: "الأصناف التي تزيلها من المنيو تظهر هنا، ويمكنك إرجاعها.",
    },
    errors: {
      nameEmpty: "اكتب اسم الصنف.",
      nameTooLong: "الاسم أطول من 40 حرفا.",
      priceInvalid: "اكتب سعرا صحيحا، مثل 2.50.",
      tooLong:
        "لن يتسع المنيو في رسالة واتساب واحدة: سيصبح [الطول] حرفا والحد 4096. اختصر اسما أو أزل صنفا.",
      archived: "أُزيل هذا الصنف من جهاز آخر.",
    },
  });
  assert.equal(LENGTH_SLOT, "[الطول]");
});

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

test("no Arabic-Indic digit anywhere in the menu's dictionary", () => {
  for (const s of strings(DASHBOARD_MENU_UI_AR))
    assert.doesNotMatch(s, /[٠-٩۰-۹]/u, s);
});

test("🔴 the line under «أوقف الطلبات مؤقتا» holds ORDERS_PAUSED_AR itself — what the customer really gets", () => {
  const M = DASHBOARD_MENU_UI_AR;
  assert.equal(M.pauseHintQuote, `«${ORDERS_PAUSED_AR}»`);
  // Split in two by brief ل §4.1 — the same letters as the one line before.
  assert.equal(
    `${M.pauseHintLead} ${M.pauseHintQuote}`,
    "يتلقى كل من يراسلك: «أوقفنا استقبال الطلبات مؤقتا. راسلنا لاحقا.»",
  );
});

test("🔴 the 40 and the 4096 in the texts are MENU_ITEM_NAME_MAX and WHATSAPP_TEXT_LIMIT", () => {
  const numbers = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];
  assert.deepEqual(numbers(DASHBOARD_MENU_UI_AR.errors.nameTooLong), [
    String(MENU_ITEM_NAME_MAX),
  ]);
  assert.deepEqual(numbers(DASHBOARD_MENU_UI_AR.errors.tooLong), [
    String(WHATSAPP_TEXT_LIMIT),
  ]);
});

test("the menu's texts with a slot: the count, the name, the length", () => {
  assert.equal(offCountAr(3), "المطفأة: 3");
  assert.equal(enableAllBodyAr(12), "عددها 12، وستظهر في منيو واتساب.");
  assert.equal(removeTitleAr("شاورما دجاج"), "إزالة شاورما دجاج من المنيو؟");
  assert.equal(
    restoredLineAr("فتوش"),
    "رجع فتوش إلى «الأصناف» مطفأ. شغّله من هناك ليظهر للزبائن.",
  );
  assert.equal(
    menuTooLongAr(4123),
    "لن يتسع المنيو في رسالة واتساب واحدة: سيصبح 4123 حرفا والحد 4096. اختصر اسما أو أزل صنفا.",
  );
  // A name that itself holds a slot is not filled again.
  assert.equal(removeTitleAr("[العدد]"), "إزالة [العدد] من المنيو؟");
});
