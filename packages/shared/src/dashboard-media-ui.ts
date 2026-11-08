/**
 * A customer's media on the order's page, and the cancel dialog's line for a
 * transfer order — brief م-هـ-ب, Mohammed's texts of 22 October, verbatim.
 * A file of its own, as `dashboard-messages-ui.ts` is: a page that imports
 * anything of a module carries all of it, and the order's page alone shows
 * these. «تأكّدنا من التحويل» is `DASHBOARD_UI_AR.actions.confirmTransfer`,
 * beside the other steps, because the card shows it too.
 *
 * The same pattern otherwise: the exact wording held by a test, and
 * `check:numerals` walking every string.
 */
export const DASHBOARD_MEDIA_UI_AR = {
  /** A voice note's button, and while it plays. */
  listen: "استمع",
  stop: "أوقف",
  /** A PDF's button: the file in a new tab. */
  openFile: "افتح الملف",
  /**
   * The cancel dialog of a transfer order after «اقبل» (`accepted` ·
   * `preparing` · `ready`), under its title (decision 6).
   */
  refund: "إذا حوّل الزبون، أعِد له المبلغ.",
} as const;
