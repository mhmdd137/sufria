/**
 * `scripts/hosting-bootstrap.mjs` (brief س-4), on a real Postgres: the
 * instance `MIGRATION_DATABASE_URL` points at (`.env.test` on the laptop,
 * CI's own). Here because the web suite runs every `test/**\/*.test.mts`
 * inside `pnpm verify`, and no command of `test:db` picks up a new file.
 *
 * 🔴 A database and two roles of the test's own, created and dropped here —
 *    never `sufria_dashboard` and `sufria_engine`. Roles belong to the
 *    instance, and this suite runs beside the API's and the engine's, which
 *    log in as those two with `.env.test`'s passwords: a password reset on
 *    them would break the suites running at the same moment. The script's
 *    own names are tried end to end in the container trial (brief س-6).
 *
 * Meta is never asked: the network probe is a fake.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  META_HOSTS,
  bootstrap,
  scramVerifier,
  urlFor,
} from "../../../../scripts/hosting-bootstrap.mjs";

const ADMIN = process.env.MIGRATION_DATABASE_URL;
if (!ADMIN)
  throw new Error(
    "MIGRATION_DATABASE_URL is not set — run the tests with .env.test (CLAUDE.md, Commands)",
  );
const ADMIN_PASSWORD = decodeURIComponent(new URL(ADMIN).password);

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MIGRATIONS = readdirSync(`${ROOT}db/migrations`).filter((f) =>
  f.endsWith(".sql"),
);

const TAG = `sbt_${process.pid}_${Date.now().toString(36)}`;
const DATABASE = TAG;
const ROLES = { dashboard: `${TAG}_dash`, engine: `${TAG}_eng` };

/** Other values the environment holds, which must never be printed. */
const OTHER_SECRETS = {
  WHATSAPP_APP_SECRET: "app-secret-that-must-not-print",
  WHATSAPP_ACCESS_TOKEN: "access-token-that-must-not-print",
};

type Run = { code: number; out: string[]; err: string[]; hosts: string[] };
const runs: Run[] = [];

async function run(
  argv: string[] = [],
  {
    env = { MIGRATION_DATABASE_URL: ADMIN, ...OTHER_SECRETS },
    up = () => true,
  }: {
    env?: Record<string, string | undefined>;
    up?: (host: string) => boolean;
  } = {},
): Promise<Run> {
  const result: Run = { code: -1, out: [], err: [], hosts: [] };
  result.code = await bootstrap({
    argv,
    env,
    out: (line: string) => result.out.push(line),
    err: (line: string) => result.err.push(line),
    probe: async (host: string) => {
      result.hosts.push(host);
      return up(host);
    },
    database: DATABASE,
    roles: ROLES,
  });
  runs.push(result);
  return result;
}

/** The three values a run printed, by name. */
function printed(r: Run) {
  const value = (name: string) =>
    r.out.find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1);
  return {
    dashboard: value("SUFRIA_DASHBOARD_DATABASE_URL"),
    engine: value("SUFRIA_ENGINE_DATABASE_URL"),
    jwt: value("JWT_SECRET"),
  };
}

async function query<T extends pg.QueryResultRow>(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

/** Who a URL logs in as — or the error's code when it cannot. */
async function whoAmI(
  url: string,
): Promise<{ who?: string; su?: boolean; error?: string }> {
  try {
    const [row] = await query<{ who: string; su: boolean }>(
      url,
      "SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su",
    );
    return row;
  } catch (error) {
    return { error: (error as { code?: string }).code ?? String(error) };
  }
}

before(async () => {
  // As 0003 creates the real two: LOGIN, no password.
  await query(ADMIN, `CREATE ROLE ${ROLES.dashboard} LOGIN`);
  await query(ADMIN, `CREATE ROLE ${ROLES.engine} LOGIN`);
});

after(async () => {
  await query(ADMIN, `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await query(ADMIN, `DROP ROLE IF EXISTS ${ROLES.dashboard}`);
  await query(ADMIN, `DROP ROLE IF EXISTS ${ROLES.engine}`);
});

let first: ReturnType<typeof printed>;

test("first run: the database, every migration, the network, and the three values", async () => {
  const r = await run();
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.deepEqual(r.err, []);
  for (const name of MIGRATIONS) assert.ok(r.out.includes(`→ ${name}`), name);
  assert.ok(r.out.includes(`✓ database ${DATABASE} created (icu ar-JO)`));
  assert.ok(
    r.out.includes(
      `✓ migrations: ${MIGRATIONS.length} applied, ${MIGRATIONS.length} new`,
    ),
  );
  assert.ok(
    r.out.includes("✓ network: graph.facebook.com ✓ · lookaside.fbsbx.com ✓"),
  );
  assert.deepEqual(r.hosts.sort(), [...META_HOSTS].sort());
  assert.ok(r.out.includes("Put these in Environment — shown this once:"));

  first = printed(r);
  assert.ok(first.dashboard && first.engine && first.jwt);
  assert.match(first.jwt, /^[A-Za-z0-9+/]{64}$/);
  const u = new URL(first.dashboard);
  const admin = new URL(ADMIN);
  assert.equal(u.username, ROLES.dashboard);
  assert.equal(u.host, admin.host);
  assert.equal(u.pathname, `/${DATABASE}`);
  assert.match(decodeURIComponent(u.password), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(new URL(first.engine).username, ROLES.engine);
});

test("the printed values log in, as the two roles, neither a superuser", async () => {
  assert.deepEqual(await whoAmI(first.dashboard!), {
    who: ROLES.dashboard,
    su: false,
  });
  assert.deepEqual(await whoAmI(first.engine!), {
    who: ROLES.engine,
    su: false,
  });
});

test("second run: nothing new, and no password — the first ones still log in", async () => {
  const r = await run();
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.ok(r.out.includes(`✓ database ${DATABASE} ready (icu ar-JO)`));
  assert.ok(
    r.out.includes(`✓ migrations: ${MIGRATIONS.length} applied, 0 new`),
  );
  assert.ok(!r.out.some((l) => l.startsWith("→ ")));
  assert.ok(
    r.out.includes(
      "passwords unchanged (use --reset-passwords to make new ones)",
    ),
  );
  assert.deepEqual(printed(r), {
    dashboard: undefined,
    engine: undefined,
    jwt: undefined,
  });
  assert.equal((await whoAmI(first.dashboard!)).who, ROLES.dashboard);
  assert.equal((await whoAmI(first.engine!)).who, ROLES.engine);
});

test("--reset-passwords: three new values; the old passwords no longer log in", async () => {
  const r = await run(["--reset-passwords"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  const fresh = printed(r);
  assert.ok(fresh.dashboard && fresh.engine && fresh.jwt);
  assert.notEqual(fresh.dashboard, first.dashboard);
  assert.notEqual(fresh.engine, first.engine);
  assert.notEqual(fresh.jwt, first.jwt);
  assert.equal((await whoAmI(fresh.dashboard)).who, ROLES.dashboard);
  assert.equal((await whoAmI(fresh.engine)).who, ROLES.engine);
  assert.deepEqual(await whoAmI(first.dashboard!), { error: "28P01" });
  first = fresh;
});

test("a host that does not answer: ✗ and what it means — still done; --skip-network asks no one", async () => {
  const down = await run([], { up: (h) => h !== "lookaside.fbsbx.com" });
  assert.equal(down.code, 0);
  assert.ok(
    down.out.includes(
      "✗ network: graph.facebook.com ✓ · lookaside.fbsbx.com ✗",
    ),
  );
  assert.ok(
    down.out.includes(
      "  the engine will not be able to send to Meta or download a customer's media from this container",
    ),
  );
  const skipped = await run(["--skip-network"]);
  assert.equal(skipped.code, 0);
  assert.deepEqual(skipped.hosts, []);
  assert.ok(skipped.out.includes("– network: not checked (--skip-network)"));
});

test("a connection that is not a superuser: one line, and nothing done", async () => {
  const r = await run([], {
    env: { MIGRATION_DATABASE_URL: first.dashboard },
  });
  assert.equal(r.code, 1);
  assert.deepEqual(r.out, []);
  assert.deepEqual(r.err, [
    "✗ MIGRATION_DATABASE_URL does not connect as a superuser — the script reads pg_authid and creates the database; use the platform's admin",
  ]);
  assert.deepEqual(r.hosts, []);
});

test("the admin: MIGRATION_DATABASE_URL first, else the platform's DATABASE_URL, else a stop", async () => {
  const viaPlatform = await run(["--skip-network"], {
    env: { DATABASE_URL: ADMIN },
  });
  assert.equal(viaPlatform.code, 0, viaPlatform.err.join("\n"));
  const none = await run([], { env: {} });
  assert.equal(none.code, 1);
  assert.deepEqual(none.err, [
    "✗ neither MIGRATION_DATABASE_URL nor DATABASE_URL is set — the script needs the admin's connection",
  ]);
  const unknown = await run(["--force"]);
  assert.equal(unknown.code, 1);
});

/** A port no one listens on, for the API's trial. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
  });
}

/** The API from its sources, as `pnpm --filter … dev` runs it, until it listens or exits. */
async function startApi(databaseUrl: string) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["--import", "@swc-node/register/esm-register", "src/main.ts"],
    {
      cwd: `${ROOT}apps/dashboard-api`,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: databaseUrl,
        JWT_SECRET: "a-test-secret-of-sixteen-or-more",
        DASHBOARD_API_PORT: String(port),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  return new Promise<{
    listening: boolean;
    code: number | null;
    output: string;
  }>((resolve) => {
    let listening = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const watch = setInterval(() => {
      if (!listening && output.includes(`المنفذ ${port}`)) {
        listening = true;
        child.kill("SIGTERM");
      }
    }, 100);
    child.once("exit", (code) => {
      clearInterval(watch);
      clearTimeout(timer);
      resolve({ listening, code, output });
    });
  });
}

test("the guard: the API starts with the printed URL, and refuses the admin's", async () => {
  const ok = await startApi(first.dashboard!);
  assert.equal(ok.listening, true, ok.output);
  const refused = await startApi(ADMIN);
  assert.equal(refused.listening, false);
  assert.notEqual(refused.code, 0);
  assert.match(refused.output, /connects as a superuser or BYPASSRLS role/);
});

test("no secret but the generated ones is ever printed — and those on stdout alone", () => {
  const generated = runs.flatMap((r) =>
    Object.values(printed(r)).filter((v): v is string => v !== undefined),
  );
  assert.ok(generated.length >= 6);
  const passwords = generated
    .filter((v) => v.startsWith("postgres"))
    .map((v) => decodeURIComponent(new URL(v).password));
  for (const r of runs) {
    const all = [...r.out, ...r.err].join("\n");
    assert.ok(!all.includes(ADMIN_PASSWORD), "the admin's password");
    assert.ok(!all.includes(ADMIN), "the admin's URL");
    for (const value of Object.values(OTHER_SECRETS))
      assert.ok(!all.includes(value), "a value of the environment");
    const err = r.err.join("\n");
    for (const value of [...generated, ...passwords])
      assert.ok(!err.includes(value), "a generated value on stderr");
  }
});

test("the SCRAM verifier is what Postgres would store, and the URL keeps the server and its options", () => {
  const salt = Buffer.alloc(16, 7);
  const verifier = scramVerifier("pencil", salt);
  assert.match(
    verifier,
    /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/,
  );
  assert.equal(scramVerifier("pencil", salt), verifier);
  assert.notEqual(scramVerifier("pencil"), verifier);
  assert.equal(
    urlFor("postgres://admin:pw@db.example:6543/app?sslmode=require", {
      database: "sufria",
      user: "sufria_engine",
      password: "abc_-123",
    }),
    "postgres://sufria_engine:abc_-123@db.example:6543/sufria?sslmode=require",
  );
});
