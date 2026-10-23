/**
 * The decisions of `scripts/start-all.mjs` (brief س-2), as pure functions:
 * which child gets which environment, how long a crashed child waits before
 * it starts again, the dashboard's port, and the lines the runner writes.
 * The runner itself only spawns, pipes and waits — what can be decided
 * without a process is decided here, where `node --test` reaches it
 * (`apps/dashboard-web/test/hosting/start-all.test.mts`).
 *
 * 🔴 No line built here carries a variable's value — names only. The
 *    platform's Logs page keeps every line, and the environment holds the
 *    database passwords and Meta's token.
 */

/**
 * The two internal ports, in one place: the runner gives them to the API and
 * the engine, and `apps/dashboard-web/next.config.ts` forwards `/api` and the
 * webhook to them. Fixed, not read from the environment: Next computes its
 * rewrites when the dashboard is built.
 */
export const HOSTING_PORTS = Object.freeze({ engine: 4101, api: 4102 });

/** The dashboard's port when the platform sets no `PORT`. */
export const DEFAULT_WEB_PORT = 3000;

/** The command the waiting line points at. */
export const BOOTSTRAP_COMMAND = "node scripts/hosting-bootstrap.mjs";

/**
 * Database variables no child receives from the container as they are:
 *   - `DATABASE_URL` — 🔴 the platform injects it, as its admin, which
 *     bypasses RLS. The API's own `DATABASE_URL` is replaced, never inherited.
 *   - `ENGINE_DATABASE_URL` — the same for the engine.
 *   - `MIGRATION_DATABASE_URL` — the admin's, for the bootstrap script alone.
 *   - the two `SUFRIA_*` sources: each child gets the one value it needs,
 *     under the name it reads, and nothing else.
 */
const STRIPPED = Object.freeze([
  "DATABASE_URL",
  "ENGINE_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "SUFRIA_DASHBOARD_DATABASE_URL",
  "SUFRIA_ENGINE_DATABASE_URL",
]);

/**
 * @typedef {{
 *   name: "api" | "engine" | "web",
 *   cwd: string,
 *   args: string[],
 *   env: Record<string, string>,
 *   missing: string | null,
 * }} ChildSpec
 * `cwd` is relative to the repository root; `args` follow `node`. `missing`
 * names the variable the child cannot start without, or is null.
 */

/** A copy of `env` without the stripped names and without unset values. */
function baseEnv(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && !STRIPPED.includes(key)) out[key] = value;
  return out;
}

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The three children, in the order they start.
 *
 * @param {Record<string, string | undefined>} env the container's environment
 * @param {number} webPort from `webPort(env)`
 * @returns {ChildSpec[]}
 */
export function childSpecs(env, webPort) {
  const dashboardUrl = env.SUFRIA_DASHBOARD_DATABASE_URL;
  const engineUrl = env.SUFRIA_ENGINE_DATABASE_URL;
  return [
    {
      name: "api",
      cwd: "apps/dashboard-api",
      args: ["dist/main.js"],
      env: {
        ...baseEnv(env),
        DASHBOARD_API_PORT: String(HOSTING_PORTS.api),
        ...(present(dashboardUrl) ? { DATABASE_URL: dashboardUrl } : {}),
      },
      missing: present(dashboardUrl) ? null : "SUFRIA_DASHBOARD_DATABASE_URL",
    },
    {
      name: "engine",
      cwd: "apps/conversation-engine",
      args: ["dist/main.js"],
      env: {
        ...baseEnv(env),
        ENGINE_PORT: String(HOSTING_PORTS.engine),
        ...(present(engineUrl) ? { ENGINE_DATABASE_URL: engineUrl } : {}),
      },
      missing: present(engineUrl) ? null : "SUFRIA_ENGINE_DATABASE_URL",
    },
    {
      // The dashboard starts whatever the database: it is the page that
      // shows the app is up, and it needs no database of its own.
      name: "web",
      cwd: "apps/dashboard-web",
      args: [
        "node_modules/next/dist/bin/next",
        "start",
        "-p",
        String(webPort),
        "-H",
        "0.0.0.0",
      ],
      env: baseEnv(env),
      missing: null,
    },
  ];
}

/**
 * The dashboard's port: `PORT`, or 3000.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, port: number } | { ok: false, reason: string }}
 *   `reason` names the variable, never its value.
 */
export function webPort(env) {
  const raw = env.PORT;
  if (!present(raw)) return { ok: true, port: DEFAULT_WEB_PORT };
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, reason: "PORT is not a port number (1–65535)" };
  if (port === HOSTING_PORTS.api || port === HOSTING_PORTS.engine)
    return {
      ok: false,
      reason: `PORT is ${port}, which the ${port === HOSTING_PORTS.api ? "API" : "engine"} uses inside the container (${HOSTING_PORTS.engine} and ${HOSTING_PORTS.api} are taken)`,
    };
  return { ok: true, port };
}

/** The waits before a crashed child starts again; the last one repeats. */
export const RESTART_DELAYS_MS = Object.freeze([
  2000, 5000, 10000, 30000, 60000,
]);

/** A child that ran this long before it exited starts the table over. */
export const STABLE_AFTER_MS = 5 * 60 * 1000;

/**
 * Where a child that just exited stands in the table.
 *
 * @param {number} failures exits in a row so far, before this one
 * @param {number} ranMs how long this run lasted
 * @returns {{ failures: number, delayMs: number }} the count after this
 *   exit, and the wait before the next start
 */
export function nextRestart(failures, ranMs) {
  const count = ranMs >= STABLE_AFTER_MS ? 1 : failures + 1;
  const delayMs =
    RESTART_DELAYS_MS[Math.min(count, RESTART_DELAYS_MS.length) - 1];
  return { failures: count, delayMs };
}

/** How often the waiting line repeats, and the memory line's default. */
export const WAITING_EVERY_MS = 60 * 1000;
export const MEMORY_EVERY_MS = 10 * 60 * 1000;

/**
 * The memory line's period: `START_ALL_MEMORY_EVERY_MS` when it is a
 * positive integer (a short one for a trial), else every 10 minutes.
 *
 * @param {Record<string, string | undefined>} env
 */
export function memoryEveryMs(env) {
  const n = Number(env.START_ALL_MEMORY_EVERY_MS);
  return Number.isInteger(n) && n > 0 ? n : MEMORY_EVERY_MS;
}

/** @param {string} name @param {string} variable */
export function waitingLine(name, variable) {
  return `[start-all] ${name} waiting: ${variable} is not set — run: ${BOOTSTRAP_COMMAND}`;
}

/** `45s` · `12m` · `3h07m` · `2d03h` */
export function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d${pad(h % 24)}h`;
}

/**
 * `[start-all] rss api=… engine=… web=… total=… MB · up=…` — each child's
 * resident memory, its own process and every process under it, in MB. A
 * child that is not running reads `-`. A gap between two of these lines in
 * the Logs is a time the container did not run: the platform put it to
 * sleep.
 *
 * @param {{ api: number | null, engine: number | null, web: number | null }} rssBytes
 * @param {number} uptimeMs since the runner started
 */
export function memoryLine(rssBytes, uptimeMs) {
  const mb = (b) => Math.round(b / (1024 * 1024));
  const one = (b) => (b === null ? "-" : String(mb(b)));
  const total = [rssBytes.api, rssBytes.engine, rssBytes.web].reduce(
    (sum, b) => sum + (b ?? 0),
    0,
  );
  return `[start-all] rss api=${one(rssBytes.api)} engine=${one(rssBytes.engine)} web=${one(rssBytes.web)} total=${mb(total)} MB · up=${formatUptime(uptimeMs)}`;
}

/**
 * Cuts a child's output into lines and writes each one with its prefix —
 * `[api] …`. A last line with no newline is written at `end()`.
 *
 * @param {string} prefix e.g. `[api] `
 * @param {(line: string) => void} write one whole line, without `\n`
 */
export function lineSplitter(prefix, write) {
  let rest = "";
  return {
    /** @param {string} chunk */
    push(chunk) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) write(prefix + line.replace(/\r$/, ""));
    },
    end() {
      if (rest !== "") write(prefix + rest);
      rest = "";
    },
  };
}

/**
 * The resident memory of `pid` and all its descendants, in bytes, from a
 * snapshot of `/proc`: `stats` maps a pid to its parent pid and its RSS.
 * Pure, so the walk is tested without processes; the runner reads `/proc`.
 *
 * @param {number} pid
 * @param {Map<number, { ppid: number, rssBytes: number }>} stats
 * @returns {number | null} null when `pid` is not in the snapshot
 */
export function treeRss(pid, stats) {
  if (!stats.has(pid)) return null;
  let total = 0;
  const queue = [pid];
  const seen = new Set();
  while (queue.length) {
    const p = /** @type {number} */ (queue.shift());
    if (seen.has(p)) continue;
    seen.add(p);
    total += stats.get(p)?.rssBytes ?? 0;
    for (const [child, s] of stats) if (s.ppid === p) queue.push(child);
  }
  return total;
}

/**
 * One `/proc/<pid>/status` → its parent pid and resident memory. `VmRSS` is
 * in kB; a process with no memory of its own (a kernel thread, a zombie)
 * has no `VmRSS` line and counts 0.
 *
 * @param {string} text
 * @returns {{ ppid: number, rssBytes: number } | null}
 */
export function parseProcStatus(text) {
  const ppid = /^PPid:\s+(\d+)$/m.exec(text);
  if (!ppid) return null;
  const rss = /^VmRSS:\s+(\d+) kB$/m.exec(text);
  return { ppid: Number(ppid[1]), rssBytes: rss ? Number(rss[1]) * 1024 : 0 };
}

/** How long the runner waits for its children after SIGTERM or SIGINT. */
export const SHUTDOWN_GRACE_MS = 10 * 1000;
