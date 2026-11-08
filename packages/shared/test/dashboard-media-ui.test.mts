/**
 * The media and transfer texts of the order's page — brief م-هـ-ب, verbatim
 * (Mohammed, 22 October): the four of `dashboard-media-ui.ts`. The step
 * «تأكّدنا من التحويل» is held with the others, in `dashboard-ui.test.mts`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DASHBOARD_MEDIA_UI_AR } from "@sufria/shared";

test("DASHBOARD_MEDIA_UI_AR is Mohammed's text, verbatim", () => {
  assert.deepEqual(DASHBOARD_MEDIA_UI_AR, {
    listen: "استمع",
    stop: "أوقف",
    openFile: "افتح الملف",
    refund: "إذا حوّل الزبون، أعِد له المبلغ.",
  });
});

test("no Arabic-Indic digit in the media texts", () => {
  for (const s of Object.values(DASHBOARD_MEDIA_UI_AR))
    assert.doesNotMatch(s, /[٠-٩۰-۹]/u, s);
});
