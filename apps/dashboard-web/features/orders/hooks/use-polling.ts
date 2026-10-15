"use client";

import { useEffect, useRef } from "react";

export type PollingOptions = {
  /**
   * Keep polling while the browser tab is hidden (brief م-ب, decision 8):
   * the live list alone, so the sound rings with another tab in front. The
   * browser slows a hidden tab's timers to about once a minute.
   */
  whileHidden?: boolean;
};

/** What `startPolling` touches of the browser — a fake one in the tests. */
export type PollingEnv = {
  document: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  window: Pick<Window, "setInterval" | "clearInterval">;
};

/**
 * `tick` now, then every `ms`, while the browser tab is visible — never while
 * it is hidden, and at once when it is shown again (brief G §3, brief I §4).
 * With `whileHidden`, hiding the tab leaves the clock running; showing it
 * still reads at once. Returns the stop.
 */
export function startPolling(
  tick: () => void,
  ms: number,
  { whileHidden = false }: PollingOptions = {},
  env: PollingEnv = { document, window },
): () => void {
  const { document: doc, window: win } = env;
  let timer: number | undefined;
  const visible = () => doc.visibilityState === "visible";
  const run = () => {
    if (whileHidden || visible()) tick();
  };
  const start = () => {
    win.clearInterval(timer);
    if (!whileHidden && !visible()) return;
    run();
    timer = win.setInterval(run, ms);
  };
  const changed = () => {
    // Hidden, with `whileHidden`: the clock goes on as it was.
    if (whileHidden && !visible()) return;
    start();
  };
  start();
  doc.addEventListener("visibilitychange", changed);
  return () => {
    win.clearInterval(timer);
    doc.removeEventListener("visibilitychange", changed);
  };
}

/**
 * `startPolling` for a component's life. The latest `tick` is the one
 * called: it may change between renders without restarting the clock.
 */
export function usePolling(
  tick: () => void,
  ms: number,
  options: PollingOptions = {},
): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  const { whileHidden = false } = options;
  useEffect(
    () => startPolling(() => latest.current(), ms, { whileHidden }),
    [ms, whileHidden],
  );
}
