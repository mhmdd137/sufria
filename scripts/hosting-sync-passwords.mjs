/**
 * node scripts/hosting-sync-passwords.mjs
 *
 * When the role passwords in Environment and in Postgres disagree — a value
 * copied by hand from the Terminal lost or changed a character — this makes
 * Postgres take the ones in Environment: the password inside
 * SUFRIA_DASHBOARD_DATABASE_URL for `sufria_dashboard`, and the one inside
 * SUFRIA_ENGINE_DATABASE_URL for `sufria_engine`. Nothing to copy, nothing
 * printed but the roles' names and ✓ / ✗.
 *
 * Connects as the admin, as hosting-bootstrap.mjs does. Then tries each URL
 * as it is, the way the app will.
 */
import pg from "pg";

import { ROLES, scramVerifier } from "./hosting-bootstrap.mjs";

const PAIRS = [
  [ROLES.dashboard, "SUFRIA_DASHBOARD_DATABASE_URL"],
  [ROLES.engine, "SUFRIA_ENGINE_DATABASE_URL"],
];

async function main() {
  const admin = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!admin) throw new Error("no DATABASE_URL in this container");

  const wanted = PAIRS.map(([role, name]) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL (a space in it?)`);
    }
    if (decodeURIComponent(url.username) !== role)
      throw new Error(`${name}: the user is not ${role}`);
    return { role, name, value, password: decodeURIComponent(url.password) };
  });

  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    for (const { role, password } of wanted)
      await client.query(
        `ALTER ROLE ${client.escapeIdentifier(role)} PASSWORD ${client.escapeLiteral(scramVerifier(password))}`,
      );
  } finally {
    await client.end().catch(() => {});
  }

  let failed = false;
  for (const { role, value } of wanted) {
    const app = new pg.Client({ connectionString: value });
    try {
      await app.connect();
      await app.query("SELECT 1");
      process.stdout.write(`✓ ${role}\n`);
    } catch (error) {
      failed = true;
      process.stdout.write(`✗ ${role}: ${error.code ?? "error"}\n`);
    } finally {
      await app.end().catch(() => {});
    }
  }
  if (failed) process.exitCode = 1;
  else process.stdout.write("Now: Restart\n");
}

main().catch((error) => {
  process.stdout.write(`✗ ${error.message}\n`);
  process.exitCode = 1;
});
