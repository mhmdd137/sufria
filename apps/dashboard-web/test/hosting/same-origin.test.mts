/**
 * One address on Taqat (brief س-3): `next.config.ts` read as Next reads it,
 * built with and without `SUFRIA_SAME_ORIGIN=1`. Development must not
 * change — no rewrites at all — and the build for Taqat forwards `/api` and
 * the webhook to the ports `scripts/start-all.mjs` gives the API and the
 * engine. That the body reaches the engine byte for byte is tried with a
 * real build and a signed request (brief س-6), not here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { HOSTING_PORTS } from "../../../../scripts/start-all-lib.mjs";
import { createHttp } from "../../shared/api/http.ts";
import { memorySessionStore } from "../../shared/api/session-store.ts";

const CONFIG = new URL("../../next.config.ts", import.meta.url).href;

/**
 * The config as a build with `value` would read it. A fresh module each
 * time (the query string), and the variable set before the import — set,
 * even empty, it wins over a root `.env` the config loads.
 */
async function configWith(value: string, tag: string) {
  const before = process.env.SUFRIA_SAME_ORIGIN;
  process.env.SUFRIA_SAME_ORIGIN = value;
  try {
    return (await import(`${CONFIG}?${tag}`)).default;
  } finally {
    if (before === undefined) delete process.env.SUFRIA_SAME_ORIGIN;
    else process.env.SUFRIA_SAME_ORIGIN = before;
  }
}

test("development is unchanged: without SUFRIA_SAME_ORIGIN=1 there are no rewrites", async () => {
  for (const [value, tag] of [
    ["", "unset"],
    ["0", "zero"],
    ["true", "true"],
  ]) {
    const config = await configWith(value, tag);
    assert.equal(config.rewrites, undefined, `SUFRIA_SAME_ORIGIN=${value}`);
    assert.equal(config.agentRules, false);
  }
});

test("SUFRIA_SAME_ORIGIN=1: /api to the API and the webhook to the engine, on their fixed ports", async () => {
  const config = await configWith("1", "same");
  assert.equal(typeof config.rewrites, "function");
  assert.deepEqual(await config.rewrites(), [
    { source: "/api/:path*", destination: "http://127.0.0.1:4102/:path*" },
    {
      source: "/webhooks/whatsapp",
      destination: "http://127.0.0.1:4101/webhooks/whatsapp",
    },
  ]);
  assert.deepEqual(HOSTING_PORTS, { engine: 4101, api: 4102 });
});

test("NEXT_PUBLIC_API_URL=/api: the client asks /api/… on its own origin, nothing absolute", async () => {
  const urls: string[] = [];
  const fetch = (async (input: string) => {
    urls.push(input);
    return new Response(
      JSON.stringify({ orders: [], page: 1, hasMore: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  const store = memorySessionStore({
    accessToken: "a",
    refreshToken: "r",
    restaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    restaurantName: "x",
  });
  for (const baseUrl of ["/api", "/api/"]) {
    const http = createHttp({ baseUrl, store, fetch });
    const res = await http.call("/orders?tab=active", {
      method: "GET",
      auth: "restaurant",
    });
    assert.equal(res.ok, true);
  }
  assert.deepEqual(urls, ["/api/orders?tab=active", "/api/orders?tab=active"]);
});
