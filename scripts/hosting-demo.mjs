/**
 * node scripts/hosting-demo.mjs [--check]
 *
 * The demo restaurant on Taqat in one short command — a phone's Terminal
 * closes before the long one is typed. The admin URL is the platform's
 * DATABASE_URL pointed at `sufria` (its query, if any, kept), then the
 * compiled setup script runs with db/restaurants/demo.json. Its output, the
 * staff password among it, goes to the Terminal alone.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DATABASE, urlFor } from "./hosting-bootstrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const admin = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!admin) {
  process.stdout.write("✗ no DATABASE_URL in this container\n");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "apps/dashboard-api/dist/scripts/setup-restaurant.js",
    "db/restaurants/demo.json",
    ...process.argv.slice(2),
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: urlFor(admin, { database: DATABASE }),
    },
  },
);
process.exitCode = result.status ?? 1;
