/**
 * The dashboard's alert sound — brief م-ب, Mohammed's texts of 13 October
 * (19:20), verbatim: the header's button and the two strips under it, on
 * every page behind login. A module of its own, off
 * `dashboard-messages-ui.ts`: the build keeps a module whole, so the
 * messages' words would ride along on every page.
 */
export const DASHBOARD_SOUND_UI_AR = {
  mute: "اكتم الصوت",
  unmute: "شغّل الصوت",
  muted: "صوت التنبيه مكتوم على هذا الجهاز",
  blocked: "المتصفح أوقف الصوت",
} as const;
