/**
 * node scripts/hosting-bootstrap.mjs [--reset-passwords] [--skip-network]
 *
 * One command in Taqat's Terminal (brief س-4): the database `sufria`, every
 * migration, the two app roles' passwords, and the values to put in
 * Environment. Run it once after the first deploy, and again after every
 * merge that brings a migration. A second run changes nothing but what is
 * new: no database is recreated, a migration runs once, and the passwords
 * stay as they are unless `--reset-passwords`.
 *
 * Connects as the admin: `MIGRATION_DATABASE_URL` when set, else the
 * platform's `DATABASE_URL` — which must be a superuser (`pg_authid` asks
 * for one), or the script stops. The database in the URL is only the way
 * in; the work happens in `sufria`.
 *
 *   1. `sufria`, created when missing — ICU ar-JO, as CLAUDE.md builds it;
 *      C.UTF-8 alone, with a warning, where ICU is not there.
 *   2. The migrations, through `migrate.mjs` itself (its ledger, its lock).
 *   3. The first time alone — a role with no password, as 0003 creates it —
 *      or with `--reset-passwords`: a new password for `sufria_dashboard`
 *      and `sufria_engine`, and a new `JWT_SECRET`.
 *   4. Can this container reach Meta? A HEAD to its two hosts, 5 s each.
 *      `--skip-network` leaves them out (a trial where Meta must not be
 *      asked).
 *
 * 🔴 Secrets. The admin's password and every value of the environment are
 *    never printed. The three generated values are printed once, at the
 *    end, on stdout alone — the Terminal — never on stderr, never in a
 *    file. The passwords travel to Postgres as SCRAM verifiers, computed
 *    here, so not even a statement log on the server holds them.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

import { migrate } from "./migrate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DATABASE = "sufria";
export const ROLES = Object.freeze({
  dashboard: "sufria_dashboard",
  engine: "sufria_engine",
});
export const META_HOSTS = Object.freeze([
  "graph.facebook.com",
  "lookaside.fbsbx.com",
]);

const USAGE =
  "usage: node scripts/hosting-bootstrap.mjs [--reset-passwords] [--skip-network]";

/** 24 random bytes, base64url: URL-safe as it is, no percent-encoding. */
export function newPassword() {
  return randomBytes(24).toString("base64url");
}

/** 48 random bytes, base64 — what `.env.example` asks of JWT_SECRET. */
export function newJwtSecret() {
  return randomBytes(48).toString("base64");
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for `password` (RFC 7677, the
 * format of `pg_authid.rolpassword`). Given to `ALTER ROLE … PASSWORD`,
 * Postgres keeps it as it is, and the password itself never reaches the
 * server.
 *
 * @param {string} password
 * @param {Buffer} [salt]
 */
export function scramVerifier(password, salt = randomBytes(16)) {
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
  const storedKey = createHash("sha256")
    .update(hmac(salted, "Client Key"))
    .digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * The same server, port and options as `url`, another database and — when
 * given — another user and password.
 *
 * @param {string} url
 * @param {{ database: string, user?: string, password?: string }} to
 */
export function urlFor(url, { database, user, password }) {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  if (user !== undefined) u.username = encodeURIComponent(user);
  if (password !== undefined) u.password = encodeURIComponent(password);
  return u.toString();
}

/** Any answer is a reachable host; no answer in `timeoutMs` is not. */
export async function headProbe(host, timeoutMs = 5000) {
  try {
    await fetch(`https://${host}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

class Stop extends Error {}

/** @param {pg.Client} client */
async function one(client, sql, params) {
  return (await client.query(sql, params)).rows[0];
}

async function withClient(url, work) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** `icu ar-JO` · `libc C.UTF-8` — read from the catalog, on any version. */
async function localeOf(client, database) {
  // `daticulocale` became `datlocale` in Postgres 17: read through jsonb.
  const row = await one(
    client,
    `SELECT d.datlocprovider AS provider, d.datcollate AS collate,
            COALESCE(to_jsonb(d) ->> 'datlocale', to_jsonb(d) ->> 'daticulocale') AS locale
       FROM pg_database d WHERE d.datname = $1`,
    [database],
  );
  const provider = { i: "icu", c: "libc", b: "builtin" }[row.provider];
  return `${provider ?? row.provider} ${provider === "libc" ? row.collate : row.locale}`;
}

/**
 * @param {{
 *   argv?: readonly string[],
 *   env?: Record<string, string | undefined>,
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 *   probe?: (host: string) => Promise<boolean>,
 *   database?: string,
 *   roles?: { dashboard: string, engine: string },
 *   migrationsDir?: string,
 * }} [options] `database` and `roles` are the script's own for every run
 *   but a test's, which works on a database and roles of its own.
 * @returns {Promise<number>} exit status: 0 done, 1 stopped
 */
export async function bootstrap({
  argv = [],
  env = process.env,
  out = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
  probe = headProbe,
  database = DATABASE,
  roles = ROLES,
  migrationsDir = join(ROOT, "db/migrations"),
} = {}) {
  const flags = new Set(argv);
  const resetPasswords = flags.delete("--reset-passwords");
  const skipNetwork = flags.delete("--skip-network");
  if (flags.size > 0) {
    err(USAGE);
    return 1;
  }

  const source = env.MIGRATION_DATABASE_URL
    ? "MIGRATION_DATABASE_URL"
    : env.DATABASE_URL
      ? "DATABASE_URL"
      : null;
  if (source === null) {
    err(
      "✗ neither MIGRATION_DATABASE_URL nor DATABASE_URL is set — the script needs the admin's connection",
    );
    return 1;
  }
  const adminUrl = /** @type {string} */ (env[source]);
  try {
    new URL(adminUrl);
  } catch {
    err(`✗ ${source} is not a postgres:// URL`);
    return 1;
  }
  const sufriaUrl = urlFor(adminUrl, { database });

  try {
    // 1 — the admin, and the database.
    const created = await withClient(adminUrl, async (client) => {
      const { rolsuper } = await one(
        client,
        "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
      );
      if (!rolsuper)
        throw new Stop(
          `✗ ${source} does not connect as a superuser — the script reads pg_authid and creates the database; use the platform's admin`,
        );
      const exists = await one(
        client,
        "SELECT 1 AS found FROM pg_database WHERE datname = $1",
        [database],
      );
      if (exists) return false;
      const name = client.escapeIdentifier(database);
      try {
        await client.query(
          `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ar-JO' LOCALE 'C.UTF-8'`,
        );
      } catch (error) {
        out(
          `! ICU ar-JO is not available here (${error.message}) — ${database} is created with C.UTF-8 alone: Arabic text sorts by code point`,
        );
        await client.query(
          `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'`,
        );
      }
      return true;
    });

    // 2 — the migrations, as `pnpm db:migrate` runs them.
    const { applied } = await migrate({
      url: sufriaUrl,
      dir: migrationsDir,
      log: (line) => out(line),
    });

    // 3 — the roles' passwords; 4 — the JWT secret with them.
    const state = await withClient(sufriaUrl, async (client) => {
      const locale = await localeOf(client, database);
      const { total } = await one(
        client,
        "SELECT count(*)::int AS total FROM migrations.applied",
      );
      const rows = (
        await client.query(
          "SELECT rolname, rolpassword IS NULL AS bare FROM pg_authid WHERE rolname = ANY($1)",
          [[roles.dashboard, roles.engine]],
        )
      ).rows;
      for (const role of [roles.dashboard, roles.engine])
        if (!rows.some((r) => r.rolname === role))
          throw new Stop(
            `✗ the role ${role} does not exist after the migrations — 0003 creates it`,
          );
      const first = rows.some((r) => r.bare);
      if (!first && !resetPasswords) return { locale, total, secrets: null };

      const secrets = {
        dashboard: newPassword(),
        engine: newPassword(),
        jwt: newJwtSecret(),
      };
      await client.query("BEGIN");
      try {
        for (const [role, password] of [
          [roles.dashboard, secrets.dashboard],
          [roles.engine, secrets.engine],
        ])
          await client.query(
            `ALTER ROLE ${client.escapeIdentifier(role)} PASSWORD ${client.escapeLiteral(scramVerifier(password))}`,
          );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
      return { locale, total, secrets };
    });

    // 5 — Meta's two hosts.
    const reach = skipNetwork
      ? null
      : await Promise.all(
          META_HOSTS.map(async (host) => [host, await probe(host)]),
        );

    // 6 — the summary.
    out("");
    out(
      `✓ database ${database} ${created ? "created" : "ready"} (${state.locale})`,
    );
    out(`✓ migrations: ${state.total} applied, ${applied.length} new`);
    if (reach === null) out("– network: not checked (--skip-network)");
    else {
      const ok = reach.every(([, up]) => up);
      out(
        `${ok ? "✓" : "✗"} network: ${reach.map(([host, up]) => `${host} ${up ? "✓" : "✗"}`).join(" · ")}`,
      );
      if (!ok)
        out(
          "  the engine will not be able to send to Meta or download a customer's media from this container",
        );
    }
    out("");
    if (state.secrets === null) {
      out("passwords unchanged (use --reset-passwords to make new ones)");
      return 0;
    }
    const { secrets } = state;
    out("Put these in Environment — shown this once:");
    out(
      `SUFRIA_DASHBOARD_DATABASE_URL=${urlFor(adminUrl, { database, user: roles.dashboard, password: secrets.dashboard })}`,
    );
    out(
      `SUFRIA_ENGINE_DATABASE_URL=${urlFor(adminUrl, { database, user: roles.engine, password: secrets.engine })}`,
    );
    out(`JWT_SECRET=${secrets.jwt}`);
    return 0;
  } catch (error) {
    // The message alone: a Postgres error's `detail` can hold a row, and
    // nothing here prints a URL.
    err(
      error instanceof Stop
        ? error.message
        : `✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  bootstrap({ argv: process.argv.slice(2) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`✗ ${error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
