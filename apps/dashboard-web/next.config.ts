import type { NextConfig } from "next";

import { HOSTING_PORTS } from "../../scripts/start-all-lib.mjs";

// The monorepo keeps one .env at the root (.env.example). Next reads only its
// own directory, so NEXT_PUBLIC_API_URL is taken from the root file here —
// the same file the API and the engine read with --env-file-if-exists.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No root .env: lib/config.ts falls back to the development address.
}

/**
 * One address for the one app on Taqat (brief س-3, Mohammed's decision 2),
 * built with `SUFRIA_SAME_ORIGIN=1` alone (`nixpacks.toml`): the dashboard
 * on `/`, and Next forwards the API and Meta's webhook to the two programs
 * `scripts/start-all.mjs` runs inside the container. The body goes through
 * as it came — the engine checks Meta's signature on its bytes.
 *
 * Without the variable — development — there are no rewrites at all.
 * Rewrites are fixed when the dashboard is built, so the ports are too.
 */
const sameOriginRewrites = async () => [
  {
    source: "/api/:path*",
    destination: `http://127.0.0.1:${HOSTING_PORTS.api}/:path*`,
  },
  {
    source: "/webhooks/whatsapp",
    destination: `http://127.0.0.1:${HOSTING_PORTS.engine}/webhooks/whatsapp`,
  },
];

const nextConfig: NextConfig = {
  // لا تولّد AGENTS.md / CLAUDE.md داخل مجلد التطبيق
  agentRules: false,
  ...(process.env.SUFRIA_SAME_ORIGIN === "1"
    ? { rewrites: sameOriginRewrites }
    : {}),
};

export default nextConfig;
