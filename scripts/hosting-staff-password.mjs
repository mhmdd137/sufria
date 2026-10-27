/**
 * node scripts/hosting-staff-password.mjs [email]
 *
 * A new password for one staff account (demo@sufria.local when no email is
 * given) — when the old one was seen by someone, or cannot be typed right on
 * a phone. Easy to read and to type: 16 characters in four groups, lowercase
 * letters and digits with none of 0 o 1 l i (≈ 79 bits). Hashed with argon2id
 * as setup-restaurant does; the account's refresh token is cleared, so every
 * open session ends. The password is printed once, to the Terminal alone.
 */
import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { DATABASE, urlFor } from "./hosting-bootstrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// argon2 belongs to dashboard-api: resolve it from there.
const argon2 = createRequire(join(ROOT, "apps/dashboard-api/package.json"))(
  "argon2",
);

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function easyPassword() {
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let group = "";
    for (let c = 0; c < 4; c += 1)
      group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

async function main() {
  const email = process.argv[2] ?? "demo@sufria.local";
  const admin = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!admin) throw new Error("no DATABASE_URL in this container");

  const password = easyPassword();
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new pg.Client({
    connectionString: urlFor(admin, { database: DATABASE }),
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE staff_accounts
          SET password_hash = $1,
              refresh_token_hash = NULL,
              refresh_token_expires_at = NULL,
              updated_at = now()
        WHERE phone_or_email = $2`,
      [hash, email],
    );
    if (rowCount !== 1) throw new Error(`no staff account ${email}`);
  } finally {
    await client.end().catch(() => {});
  }

  process.stdout.write(`✓ new password for ${email} — shown this once:\n`);
  process.stdout.write(`  ${password}\n`);
}

main().catch((error) => {
  process.stdout.write(`✗ ${error.message}\n`);
  process.exitCode = 1;
});
