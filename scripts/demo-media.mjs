/**
 * Demo script: a customer's media on an order, through the API, as the
 * order's page will show it (brief م-هـ-أ §10).
 *
 * 🔴 A development tool — **never with a real restaurant.** The screen is
 *    brief م-هـ-ب's; until it is built, this stands in for it on the laptop.
 *
 *   node --env-file=.env scripts/demo-media.mjs <order number>          # a line per media
 *   node --env-file=.env scripts/demo-media.mjs <order number> --save   # and the stored files, to a folder
 *
 * Through `GET /orders/:id/messages` and `GET /orders/:id/media/:mediaId`,
 * never the database. Reads `DEMO_STAFF_EMAIL` and `DEMO_STAFF_PASSWORD`
 * from `.env` and never prints them, nor the token — **nor a caption**:
 * whether there is one, alone. Out:
 *   image stored 183 KB 1080×1920 caption:yes
 *   audio pending
 *   pdf too_large 9.1 MB
 *   OK 120 · 3 media                      (with --save: · saved to <folder>)
 *   FAIL <code> <reason>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fail(code, reason) {
  console.log(`FAIL ${code} ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refused", "demo script is not for production");
}

const USAGE =
  "node --env-file=.env scripts/demo-media.mjs <order number> [--save]";

const [numberArg, flag, ...extra] = process.argv.slice(2);
const orderNumber = Number(numberArg);
if (
  !Number.isInteger(orderNumber) ||
  orderNumber <= 0 ||
  (flag !== undefined && flag !== "--save") ||
  extra.length > 0
) {
  fail("usage", USAGE);
}
const save = flag === "--save";

const email = process.env.DEMO_STAFF_EMAIL;
const password = process.env.DEMO_STAFF_PASSWORD;
if (!email || !password) {
  fail(
    "config",
    "DEMO_STAFF_EMAIL and DEMO_STAFF_PASSWORD must be set in .env",
  );
}

const base = `http://localhost:${process.env.DASHBOARD_API_PORT || 3002}`;

/** A JSON request. The body on 2xx (null on 204); a FAIL line otherwise. */
async function call(method, path, { token, restaurantId, body } = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(restaurantId ? { "x-restaurant-id": restaurantId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(
      "network",
      `${base} unreachable — is dashboard-api running? (${error.cause?.code ?? error.message})`,
    );
  }
  if (res.status === 204) return null;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 409 carries `code` (brief D §8.7); anything else, Nest's message.
    const detail = payload.code ?? payload.message ?? res.statusText;
    fail(res.status, Array.isArray(detail) ? detail.join("; ") : detail);
  }
  return payload;
}

const login = await call("POST", "/auth/login", {
  body: { phoneOrEmail: email, password },
});
// An account in several branches: order numbers are per restaurant, so the
// number alone is ambiguous.
if (login.restaurants.length !== 1) {
  fail(
    "config",
    `the demo account must belong to exactly one restaurant (it belongs to ${login.restaurants.length})`,
  );
}
const auth = {
  token: login.accessToken,
  restaurantId: login.restaurants[0].id,
};

// The order by its number (brief م-هـ-أ §10): on its way, or a closed one a
// message brought back, then the first page of history — a transfer receipt
// can come after the order is done.
const active = await call("GET", "/orders?tab=active", auth);
let order = [...active.orders, ...active.returned].find(
  (o) => o.orderNumber === orderNumber,
);
if (!order) {
  const history = await call("GET", "/orders?tab=history", auth);
  order = history.orders.find((o) => o.orderNumber === orderNumber);
}
if (!order)
  fail("not_found", `no order ${orderNumber} on its way or in history`);

const { messages } = await call("GET", `/orders/${order.id}/messages`, auth);
const withMedia = messages.filter((m) => m.media);

const folder = join(tmpdir(), `sufria-media-${orderNumber}`);
if (save) mkdirSync(folder, { recursive: true });

for (const [i, m] of withMedia.entries()) {
  const { media } = m;
  const parts = [media.kind, media.state];
  if (media.sizeBytes !== null) parts.push(size(media.sizeBytes));
  if (media.width !== null) parts.push(`${media.width}×${media.height}`);
  if (m.caption !== null) parts.push("caption:yes");
  console.log(parts.join(" "));

  if (save && media.state === "stored") {
    const res = await fetch(`${base}/orders/${order.id}/media/${media.id}`, {
      headers: {
        authorization: `Bearer ${auth.token}`,
        "x-restaurant-id": auth.restaurantId,
      },
    });
    if (!res.ok) fail(res.status, `media ${i + 1} not served`);
    const name = `${i + 1}-${media.kind}.${extension(media)}`;
    writeFileSync(join(folder, name), Buffer.from(await res.arrayBuffer()));
  }
}

console.log(
  `OK ${orderNumber} · ${withMedia.length} media${save ? ` · saved to ${folder}` : ""}`,
);

/** `183 KB`, `9.1 MB` — 1024s, one decimal for MB. */
function size(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The file's extension from its MIME type — ours, never the customer's name. */
function extension(media) {
  const base = media.mimeType.split(";")[0].trim().toLowerCase();
  return (
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/aac": "aac",
      "audio/mp4": "m4a",
      "audio/amr": "amr",
      "application/pdf": "pdf",
    }[base] ?? "bin"
  );
}
