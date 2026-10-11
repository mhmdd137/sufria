import styles from "./pause-icon.module.css";

/**
 * The pause sign — before «أوقف الطلبات مؤقتا» and before the strip's text
 * (brief ي-ب-9 §4.3, §4.5): two bars drawn in CSS, no SVG. Hidden from
 * screen readers: the words beside it say it.
 */
export function PauseIcon() {
  return <span className={styles.icon} aria-hidden="true" />;
}
