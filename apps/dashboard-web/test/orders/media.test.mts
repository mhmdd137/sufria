/**
 * A customer's media on the order's page (brief م-هـ-ب): the call, its
 * rule (`call`'s, with the bytes as the answer), and the page's store — one
 * download per media, three attempts for an image, every URL revoked at the
 * end. A recording `fetch` stands in for the network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createOrdersApi } from "../../features/orders/api/orders-api.ts";
import {
  MEDIA_MAX_ATTEMPTS,
  createMediaStore,
  type MediaStoreDeps,
} from "../../features/orders/lib/media.ts";
import type { ApiResult } from "../../shared/api/http.ts";
import { createHttp } from "../../shared/api/http.ts";
import {
  memorySessionStore,
  type Session,
} from "../../shared/api/session-store.ts";

const SESSION: Session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  restaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  restaurantName: "مطعم",
};
const ORDER_ID = "f0000000-0000-4000-8000-00000000000a";
const MEDIA_ID = "e0000000-0000-4000-8000-000000000001";

type Call = { url: string; method: string; headers: Record<string, string> };

function recorder(replies: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    calls.push({
      url: input,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected call ${input}`);
    return reply();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const file = () =>
  new Response(BYTES, {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  });
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function apiOn(baseUrl: string, fetch: typeof globalThis.fetch) {
  const store = memorySessionStore(SESSION);
  return {
    api: createOrdersApi(createHttp({ baseUrl, store, fetch })),
    store,
  };
}

test("media: GET /orders/:id/media/:mediaId with the token and the restaurant, its bytes a Blob", async () => {
  const { calls, fetch } = recorder([file]);
  const { api } = apiOn("http://api.test", fetch);
  const res = await api.media(ORDER_ID, MEDIA_ID);
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.value instanceof Blob);
  assert.deepEqual(
    res.ok && new Uint8Array(await res.value.arrayBuffer()),
    BYTES,
  );
  assert.equal(res.ok && res.value.type, "image/jpeg");
  assert.equal(
    calls[0]!.url,
    `http://api.test/orders/${ORDER_ID}/media/${MEDIA_ID}`,
  );
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.headers["Authorization"], "Bearer access-1");
  assert.equal(calls[0]!.headers["x-restaurant-id"], SESSION.restaurantId);
  assert.equal(calls[0]!.headers["Content-Type"], undefined);
});

test("media: the relative /api of the hosting build (SUFRIA_SAME_ORIGIN=1) → /api/orders/…/media/…", async () => {
  const { calls, fetch } = recorder([file]);
  const { api } = apiOn("/api", fetch);
  await api.media(ORDER_ID, MEDIA_ID);
  assert.equal(calls[0]!.url, `/api/orders/${ORDER_ID}/media/${MEDIA_ID}`);
});

test("media: a 401 refreshes once, then the same request with the new token", async () => {
  const { calls, fetch } = recorder([
    json(401, { statusCode: 401, message: "Unauthorized" }),
    json(200, { accessToken: "access-2" }),
    file,
  ]);
  const { api, store } = apiOn("http://api.test", fetch);
  const res = await api.media(ORDER_ID, MEDIA_ID);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1]!.url, "http://api.test/auth/refresh");
  assert.equal(calls[2]!.headers["Authorization"], "Bearer access-2");
  assert.equal(store.get()?.accessToken, "access-2");
});

test("media: a 401 the refresh cannot cure → unauthorized, and the session is gone (the gate takes over)", async () => {
  const { fetch } = recorder([
    json(401, { statusCode: 401, message: "Unauthorized" }),
    json(401, { statusCode: 401, message: "Unauthorized" }),
  ]);
  const { api, store } = apiOn("http://api.test", fetch);
  assert.deepEqual(await api.media(ORDER_ID, MEDIA_ID), {
    ok: false,
    error: { kind: "unauthorized" },
  });
  assert.equal(store.get(), null);
});

test("media: 404 media_not_found → { kind: http, status: 404 }; no answer → network", async () => {
  const notFound = recorder([
    json(404, {
      statusCode: 404,
      error: "Not Found",
      code: "media_not_found",
      message: "x",
    }),
  ]);
  assert.deepEqual(
    await apiOn("http://api.test", notFound.fetch).api.media(
      ORDER_ID,
      MEDIA_ID,
    ),
    { ok: false, error: { kind: "http", status: 404 } },
  );
  const down = recorder([
    () => {
      throw new TypeError("fetch failed");
    },
  ]);
  assert.deepEqual(
    await apiOn("http://api.test", down.fetch).api.media(ORDER_ID, MEDIA_ID),
    { ok: false, error: { kind: "network" } },
  );
});

// --- the page's store ------------------------------------------------------

function storeWith(replies: Array<ApiResult<Blob>>) {
  const fetched: string[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  const offline: boolean[] = [];
  let n = 0;
  const gates: Array<() => void> = [];
  const deps: MediaStoreDeps = {
    fetch: async (mediaId) => {
      fetched.push(mediaId);
      // Held until the test lets it answer: an overlapping second call.
      await new Promise<void>((resolve) => gates.push(resolve));
      const reply = replies.shift();
      if (!reply) throw new Error("unexpected fetch");
      return reply;
    },
    createUrl: () => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
    reportOffline: (o) => offline.push(o),
  };
  const release = async () => {
    while (gates.length) gates.shift()!();
    await new Promise((r) => setImmediate(r));
  };
  return {
    store: createMediaStore(deps),
    fetched,
    created,
    revoked,
    offline,
    release,
  };
}

const OK: ApiResult<Blob> = { ok: true, value: new Blob([BYTES]) };
const DOWN: ApiResult<Blob> = { ok: false, error: { kind: "network" } };
const HTTP500: ApiResult<Blob> = {
  ok: false,
  error: { kind: "http", status: 500 },
};

test("🔴 the same mediaId twice → one download: the promise in flight, then the file done (decision 4)", async () => {
  const s = storeWith([OK]);
  const a = s.store.load(MEDIA_ID);
  const b = s.store.load(MEDIA_ID);
  assert.equal(a, b);
  s.store.ensure(MEDIA_ID);
  await s.release();
  const entry = await a;
  assert.equal(entry.kind, "ready");
  // The 5 s reads after: nothing new.
  s.store.ensure(MEDIA_ID);
  assert.equal((await s.store.load(MEDIA_ID)).kind, "ready");
  assert.deepEqual(s.fetched, [MEDIA_ID]);
  assert.equal(s.created.length, 1);
  assert.equal(s.store.get(MEDIA_ID), entry);
});

test("🔴 every URL is revoked when the page closes, and nothing is downloaded after", async () => {
  const s = storeWith([OK, OK]);
  void s.store.load("m1");
  void s.store.load("m2");
  await s.release();
  s.store.dispose();
  assert.deepEqual(s.revoked.sort(), s.created.sort());
  assert.equal(s.revoked.length, 2);
  s.store.ensure("m3");
  assert.deepEqual(s.fetched, ["m1", "m2"]);
});

test("an image tries again with each read, 3 attempts at most, then gives up (decision 5)", async () => {
  const s = storeWith([HTTP500, HTTP500, HTTP500]);
  for (let attempt = 1; attempt <= MEDIA_MAX_ATTEMPTS; attempt++) {
    assert.equal(s.store.gaveUp(MEDIA_ID), false);
    s.store.ensure(MEDIA_ID);
    await s.release();
    const e = s.store.get(MEDIA_ID);
    assert.equal(e.kind, "failed");
    assert.equal(e.kind === "failed" && e.failures, attempt);
  }
  assert.equal(s.store.gaveUp(MEDIA_ID), true);
  s.store.ensure(MEDIA_ID);
  assert.equal(s.fetched.length, MEDIA_MAX_ATTEMPTS);
});

test("a failure then a success: the file, its failures forgotten", async () => {
  const s = storeWith([HTTP500, OK]);
  s.store.ensure(MEDIA_ID);
  await s.release();
  s.store.ensure(MEDIA_ID);
  await s.release();
  assert.equal(s.store.get(MEDIA_ID).kind, "ready");
  assert.equal(s.store.gaveUp(MEDIA_ID), false);
});

test("a network failure brings the strip; the next file that arrives takes it away", async () => {
  const s = storeWith([DOWN, OK]);
  s.store.ensure(MEDIA_ID);
  await s.release();
  s.store.ensure(MEDIA_ID);
  await s.release();
  assert.deepEqual(s.offline, [true, false]);
});

test("the store tells its subscribers on every change", async () => {
  const s = storeWith([OK]);
  let calls = 0;
  const off = s.store.subscribe(() => calls++);
  s.store.ensure(MEDIA_ID);
  await s.release();
  off();
  // loading, then ready.
  assert.equal(calls, 2);
});
