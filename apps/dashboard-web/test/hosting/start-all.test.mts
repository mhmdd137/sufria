/**
 * The runner of the one app on Taqat (brief س-2), `scripts/start-all.mjs`:
 * its decisions, in `scripts/start-all-lib.mjs`. Here because the web suite
 * runs every `test/**\/*.test.mts` inside `pnpm verify`, and the module is
 * plain JavaScript with no database — nothing in `package.json` changes for
 * it. The runner itself, with real processes, is tried in the container
 * (brief س-6).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOTSTRAP_COMMAND,
  DEFAULT_WEB_PORT,
  HOSTING_PORTS,
  MEMORY_EVERY_MS,
  RESTART_DELAYS_MS,
  STABLE_AFTER_MS,
  childSpecs,
  formatUptime,
  lineSplitter,
  memoryEveryMs,
  memoryLine,
  nextRestart,
  parseProcStatus,
  treeRss,
  waitingLine,
  webPort,
} from "../../../../scripts/start-all-lib.mjs";

const PLATFORM_ADMIN = "postgres://postgres:platform-admin-secret@db:5432/app";
const DASHBOARD = "postgres://sufria_dashboard:dash-secret@db:5432/sufria";
const ENGINE = "postgres://sufria_engine:engine-secret@db:5432/sufria";

/** The container as Taqat would hand it over, with the two values set. */
const CONTAINER = {
  DATABASE_URL: PLATFORM_ADMIN,
  MIGRATION_DATABASE_URL: PLATFORM_ADMIN,
  SUFRIA_DASHBOARD_DATABASE_URL: DASHBOARD,
  SUFRIA_ENGINE_DATABASE_URL: ENGINE,
  JWT_SECRET: "jwt-secret-value-0123456789",
  WHATSAPP_ACCESS_TOKEN: "meta-token-value",
  WHATSAPP_APP_SECRET: "meta-app-secret-value",
  NODE_ENV: "production",
  PORT: "8080",
};

const byName = (env: Record<string, string | undefined>) =>
  Object.fromEntries(
    childSpecs(env, 8080).map((spec) => [spec.name, spec] as const),
  );

test("the platform's DATABASE_URL reaches no child: the API's is SUFRIA_DASHBOARD_DATABASE_URL", () => {
  const { api, engine, web } = byName(CONTAINER);
  assert.equal(api.env.DATABASE_URL, DASHBOARD);
  assert.equal(engine.env.DATABASE_URL, undefined);
  assert.equal(web.env.DATABASE_URL, undefined);
  for (const spec of [api, engine, web])
    assert.ok(
      !Object.values(spec.env).includes(PLATFORM_ADMIN),
      `${spec.name} received the platform's admin URL`,
    );
});

test("the engine's ENGINE_DATABASE_URL is SUFRIA_ENGINE_DATABASE_URL, and no one else gets it", () => {
  const { api, engine, web } = byName({
    ...CONTAINER,
    ENGINE_DATABASE_URL: PLATFORM_ADMIN,
  });
  assert.equal(engine.env.ENGINE_DATABASE_URL, ENGINE);
  assert.equal(api.env.ENGINE_DATABASE_URL, undefined);
  assert.equal(web.env.ENGINE_DATABASE_URL, undefined);
});

test("MIGRATION_DATABASE_URL and the two SUFRIA_* sources reach no child", () => {
  for (const spec of childSpecs(CONTAINER, 8080)) {
    assert.equal(spec.env.MIGRATION_DATABASE_URL, undefined, spec.name);
    assert.equal(spec.env.SUFRIA_DASHBOARD_DATABASE_URL, undefined, spec.name);
    assert.equal(spec.env.SUFRIA_ENGINE_DATABASE_URL, undefined, spec.name);
  }
});

test("every other variable passes through, and each child gets its fixed port", () => {
  const { api, engine, web } = byName(CONTAINER);
  for (const spec of [api, engine, web]) {
    assert.equal(spec.env.JWT_SECRET, CONTAINER.JWT_SECRET, spec.name);
    assert.equal(spec.env.NODE_ENV, "production", spec.name);
    assert.equal(spec.missing, null, spec.name);
  }
  assert.equal(engine.env.WHATSAPP_APP_SECRET, CONTAINER.WHATSAPP_APP_SECRET);
  assert.equal(api.env.DASHBOARD_API_PORT, "4102");
  assert.equal(engine.env.ENGINE_PORT, "4101");
  assert.deepEqual(HOSTING_PORTS, { engine: 4101, api: 4102 });
  assert.deepEqual(api.args, ["dist/main.js"]);
  assert.equal(api.cwd, "apps/dashboard-api");
  assert.deepEqual(engine.args, ["dist/main.js"]);
  assert.equal(engine.cwd, "apps/conversation-engine");
  assert.equal(web.cwd, "apps/dashboard-web");
  assert.deepEqual(web.args.slice(1), ["start", "-p", "8080", "-H", "0.0.0.0"]);
});

test("a missing or blank value: that child waits, with no DATABASE_URL at all — the web starts regardless", () => {
  const { api, engine, web } = byName({
    ...CONTAINER,
    SUFRIA_DASHBOARD_DATABASE_URL: undefined,
    SUFRIA_ENGINE_DATABASE_URL: "  ",
  });
  assert.equal(api.missing, "SUFRIA_DASHBOARD_DATABASE_URL");
  assert.equal(api.env.DATABASE_URL, undefined);
  assert.equal(engine.missing, "SUFRIA_ENGINE_DATABASE_URL");
  assert.equal(engine.env.ENGINE_DATABASE_URL, undefined);
  assert.equal(web.missing, null);
});

test("the waiting line, letter for letter", () => {
  assert.equal(
    waitingLine("api", "SUFRIA_DASHBOARD_DATABASE_URL"),
    "[start-all] api waiting: SUFRIA_DASHBOARD_DATABASE_URL is not set — run: node scripts/hosting-bootstrap.mjs",
  );
  assert.equal(BOOTSTRAP_COMMAND, "node scripts/hosting-bootstrap.mjs");
});

test("the restart table: 2 · 5 · 10 · 30 · 60 s, then 60 s every time", () => {
  let failures = 0;
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const next = nextRestart(failures, 1000);
    failures = next.failures;
    waits.push(next.delayMs);
  }
  assert.deepEqual(
    waits,
    [2000, 5000, 10000, 30000, 60000, 60000, 60000, 60000],
  );
  assert.deepEqual(RESTART_DELAYS_MS, [2000, 5000, 10000, 30000, 60000]);
});

test("a child that ran 5 minutes starts the table over; 4:59 does not", () => {
  assert.equal(STABLE_AFTER_MS, 5 * 60 * 1000);
  assert.deepEqual(nextRestart(6, STABLE_AFTER_MS), {
    failures: 1,
    delayMs: 2000,
  });
  assert.deepEqual(nextRestart(6, 3 * 60 * 60 * 1000), {
    failures: 1,
    delayMs: 2000,
  });
  assert.deepEqual(nextRestart(2, STABLE_AFTER_MS - 1000), {
    failures: 3,
    delayMs: 10000,
  });
});

test("PORT: unset → 3000; a port → that port; 4101 or 4102 → refused, with the reason", () => {
  assert.deepEqual(webPort({}), { ok: true, port: DEFAULT_WEB_PORT });
  assert.equal(DEFAULT_WEB_PORT, 3000);
  assert.deepEqual(webPort({ PORT: "8080" }), { ok: true, port: 8080 });
  for (const taken of ["4101", "4102"]) {
    const result = webPort({ PORT: taken });
    assert.equal(result.ok, false, taken);
    assert.match(
      result.ok ? "" : result.reason,
      /^PORT is 410[12], which the (API|engine) uses inside the container/,
    );
  }
  for (const bad of ["abc", "0", "70000", "3000.5"])
    assert.equal(webPort({ PORT: bad }).ok, false, bad);
});

test("the memory line: MB per child, the total, the uptime — and '-' for a child not running", () => {
  const MB = 1024 * 1024;
  assert.equal(
    memoryLine({ api: 80 * MB, engine: 60 * MB, web: 120 * MB }, 3_725_000),
    "[start-all] rss api=80 engine=60 web=120 total=260 MB · up=1h02m",
  );
  assert.equal(
    memoryLine({ api: null, engine: 60 * MB, web: 120 * MB }, 45_000),
    "[start-all] rss api=- engine=60 web=120 total=180 MB · up=45s",
  );
  assert.equal(formatUptime(12 * 60_000), "12m");
  assert.equal(formatUptime((2 * 24 + 3) * 3_600_000 + 59_000), "2d03h");
  assert.equal(memoryEveryMs({}), MEMORY_EVERY_MS);
  assert.equal(MEMORY_EVERY_MS, 10 * 60 * 1000);
  assert.equal(memoryEveryMs({ START_ALL_MEMORY_EVERY_MS: "5000" }), 5000);
  assert.equal(
    memoryEveryMs({ START_ALL_MEMORY_EVERY_MS: "soon" }),
    MEMORY_EVERY_MS,
  );
});

test("no line the runner builds carries a variable's value", () => {
  const values = Object.values(CONTAINER).filter((v) => v.length > 8);
  const lines = [
    waitingLine("api", "SUFRIA_DASHBOARD_DATABASE_URL"),
    waitingLine("engine", "SUFRIA_ENGINE_DATABASE_URL"),
    memoryLine({ api: 1, engine: 2, web: 3 }, 1),
    ...["4101", "4102", "x"].map((p) => {
      const r = webPort({ ...CONTAINER, PORT: p });
      return r.ok ? "" : r.reason;
    }),
  ];
  for (const line of lines)
    for (const value of values)
      assert.ok(!line.includes(value), `a value in: ${line}`);
});

test("a child's output: one prefixed line per line, the last one at its end", () => {
  const lines: string[] = [];
  const split = lineSplitter("[api] ", (l: string) => lines.push(l));
  split.push("one\ntw");
  split.push("o\r\nthree");
  assert.deepEqual(lines, ["[api] one", "[api] two"]);
  split.end();
  assert.deepEqual(lines, ["[api] one", "[api] two", "[api] three"]);
});

test("a child's memory is its whole process tree, from /proc/<pid>/status", () => {
  const status = (ppid: number, kb?: number) =>
    `Name:\tnode\nState:\tS (sleeping)\nPPid:\t${ppid}\n${kb === undefined ? "" : `VmRSS:\t  ${kb} kB\n`}`;
  assert.deepEqual(parseProcStatus(status(1, 2048)), {
    ppid: 1,
    rssBytes: 2048 * 1024,
  });
  assert.deepEqual(parseProcStatus(status(1)), { ppid: 1, rssBytes: 0 });
  assert.equal(parseProcStatus("garbage"), null);

  const stats = new Map([
    [10, { ppid: 1, rssBytes: 100 }],
    [11, { ppid: 10, rssBytes: 20 }],
    [12, { ppid: 11, rssBytes: 3 }],
    [20, { ppid: 1, rssBytes: 999 }],
  ]);
  assert.equal(treeRss(10, stats), 123);
  assert.equal(treeRss(20, stats), 999);
  assert.equal(treeRss(30, stats), null);
});
