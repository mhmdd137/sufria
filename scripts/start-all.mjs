/**
 * node scripts/start-all.mjs — Sufria as one app (brief س-2, Mohammed's
 * decision A): the dashboard, the API and the engine as three children of
 * this process, watched and started again when they fall. Nixpacks' start
 * command (`nixpacks.toml`).
 *
 *   web     next start -p $PORT (or 3000) -H 0.0.0.0 — the one public port
 *   api     apps/dashboard-api/dist/main.js on 4102, inside the container
 *   engine  apps/conversation-engine/dist/main.js on 4101, inside the container
 *
 * The dashboard forwards `/api/…` and `/webhooks/whatsapp` to the two
 * (`apps/dashboard-web/next.config.ts`), so all three share one address.
 *
 * 🔴 The platform's `DATABASE_URL` is its admin, which bypasses RLS: no
 *    child receives it. The API's `DATABASE_URL` is
 *    `SUFRIA_DASHBOARD_DATABASE_URL`, the engine's `ENGINE_DATABASE_URL` is
 *    `SUFRIA_ENGINE_DATABASE_URL` — each child gets its own and nothing
 *    else (`start-all-lib.mjs`, `childSpecs`).
 *
 * A child that falls never stops the container — the first deploy has no
 * database yet, and the Terminal needs a running container: it starts again
 * after 2 · 5 · 10 · 30 · 60 s, then every 60 s, and a run of 5 minutes
 * starts the table over. A child whose database variable is missing does
 * not start, and says so every 60 s; the dashboard starts regardless.
 *
 * Every line of a child is prefixed with its name; the runner's own with
 * `[start-all]`. No line carries a variable's value.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOSTING_PORTS,
  SHUTDOWN_GRACE_MS,
  WAITING_EVERY_MS,
  childSpecs,
  lineSplitter,
  memoryEveryMs,
  memoryLine,
  nextRestart,
  parseProcStatus,
  treeRss,
  waitingLine,
  webPort,
} from "./start-all-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const startedAt = Date.now();
const say = (line) => process.stdout.write(`[start-all] ${line}\n`);

const port = webPort(process.env);
if (!port.ok) {
  process.stderr.write(`[start-all] ${port.reason} — not starting\n`);
  process.exit(1);
}

/**
 * @typedef {{
 *   spec: import("./start-all-lib.mjs").ChildSpec,
 *   proc: import("node:child_process").ChildProcess | null,
 *   runStartedAt: number,
 *   failures: number,
 *   timer: NodeJS.Timeout | null,
 * }} Child
 */
/** @type {Child[]} */
const children = childSpecs(process.env, port.port).map((spec) => ({
  spec,
  proc: null,
  runStartedAt: 0,
  failures: 0,
  timer: null,
}));
let stopping = false;

/** @param {Child} child */
function run(child) {
  child.timer = null;
  if (stopping) return;
  const { name, cwd, args, env } = child.spec;
  const proc = spawn(process.execPath, args, {
    cwd: join(ROOT, cwd),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.proc = proc;
  child.runStartedAt = Date.now();

  const prefix = `[${name}] `;
  const out = lineSplitter(prefix, (l) => process.stdout.write(`${l}\n`));
  const err = lineSplitter(prefix, (l) => process.stderr.write(`${l}\n`));
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => out.push(chunk));
  proc.stderr.on("data", (chunk) => err.push(chunk));
  proc.stdout.on("end", () => out.end());
  proc.stderr.on("end", () => err.end());

  proc.on("error", (error) => {
    // The code alone (ENOENT…): the error's text can hold the arguments.
    say(`${name} could not be started: ${error.code ?? "unknown error"}`);
  });
  proc.on("exit", (code, signal) => {
    child.proc = null;
    if (stopping) return;
    const next = nextRestart(child.failures, Date.now() - child.runStartedAt);
    child.failures = next.failures;
    say(
      `${name} exited (${signal ?? `code ${code}`}) — starting again in ${next.delayMs / 1000} s`,
    );
    child.timer = setTimeout(() => run(child), next.delayMs);
  });
}

/** @type {NodeJS.Timeout[]} */
const intervals = [];

say(
  `web on 0.0.0.0:${port.port} · api on ${HOSTING_PORTS.api} · engine on ${HOSTING_PORTS.engine} · node ${process.version}`,
);
for (const child of children) {
  const { name, missing } = child.spec;
  if (missing === null) {
    run(child);
    continue;
  }
  const waiting = () => process.stdout.write(`${waitingLine(name, missing)}\n`);
  waiting();
  intervals.push(setInterval(waiting, WAITING_EVERY_MS));
}

/** Each running child's memory, its process tree included, from /proc. */
function rssNow() {
  /** @type {Map<number, { ppid: number, rssBytes: number }>} */
  const stats = new Map();
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const parsed = parseProcStatus(
          readFileSync(`/proc/${entry}/status`, "utf8"),
        );
        if (parsed) stats.set(Number(entry), parsed);
      } catch {
        // The process ended between the listing and the read.
      }
    }
  } catch {
    // No /proc (not Linux): every child reads "-".
  }
  const of = (name) => {
    const proc = children.find((c) => c.spec.name === name)?.proc;
    return proc?.pid === undefined ? null : treeRss(proc.pid, stats);
  };
  return { api: of("api"), engine: of("engine"), web: of("web") };
}

intervals.push(
  setInterval(
    () =>
      process.stdout.write(`${memoryLine(rssNow(), Date.now() - startedAt)}\n`),
    memoryEveryMs(process.env),
  ),
);

/** @param {NodeJS.Signals} signal */
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  for (const id of intervals) clearInterval(id);
  for (const child of children) if (child.timer) clearTimeout(child.timer);

  const live = children.flatMap((c) => (c.proc ? [c.proc] : []));
  say(`${signal}: stopping ${live.length} children`);
  for (const proc of live) proc.kill(signal);

  const deadline = setTimeout(() => {
    for (const proc of live)
      if (proc.exitCode === null && proc.signalCode === null)
        proc.kill("SIGKILL");
    say(`children still running after ${SHUTDOWN_GRACE_MS / 1000} s — killed`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);

  void Promise.all(
    live.map(
      (proc) =>
        new Promise((resolve) => {
          if (proc.exitCode !== null || proc.signalCode !== null) resolve();
          else proc.once("exit", resolve);
        }),
    ),
  ).then(() => {
    clearTimeout(deadline);
    say("stopped");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
