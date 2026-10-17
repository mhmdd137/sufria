/**
 * Demo script: a staff member writes to an order's customer through the API,
 * as the dashboard's message box will (brief م-ج §7).
 *
 * 🔴 A development tool — **never with a real restaurant.** The screen is
 *    brief م-د's; until it is built, this stands in for it on the laptop.
 *
 *   node --env-file=.env scripts/demo-staff-message.mjs <order number> "<text>"   # sends, with a new clientId
 *   node --env-file=.env scripts/demo-staff-message.mjs <order number> --resume   # «رجّع للبوت»
 *   node --env-file=.env scripts/demo-staff-message.mjs <order number> --status   # the last staff message, the silence, the 24 hours
 *
 * Through the API, never the database: the row is written with the token's
 * staff member, the 24-hours check and `silence_until` exactly as the screen
 * will write it, and the engine's queue sends it.
 *
 * Reads `DEMO_STAFF_EMAIL` and `DEMO_STAFF_PASSWORD` from `.env` and never
 * prints them, nor the token. One line out:
 *   OK 120 pending
 *   OK 120 resumed
 *   OK 120 sent · silent 58m · window 23h49m
 *   FAIL <code> <reason>
 */
import { randomUUID } from "node:crypto";

function fail(code, reason) {
  console.log(`FAIL ${code} ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refused", "demo script is not for production");
}

const USAGE =
  'node --env-file=.env scripts/demo-staff-message.mjs <order number> ("<text>" | --resume | --status)';

const [numberArg, action, ...extra] = process.argv.slice(2);
const orderNumber = Number(numberArg);
if (
  !Number.isInteger(orderNumber) ||
  orderNumber <= 0 ||
  action === undefined ||
  extra.length > 0
) {
  fail("usage", USAGE);
}
const mode =
  action === "--resume" ? "resume" : action === "--status" ? "status" : "send";
if (mode === "send" && (action.startsWith("--") || action.trim() === "")) {
  fail("usage", USAGE);
}

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

// The order by its number: on its way, or a closed one a message brought
// back, then the first page of history — a completed order can be written
// to as well (a complaint after it, decision 2).
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

if (mode === "send") {
  const message = await call("POST", `/orders/${order.id}/messages`, {
    ...auth,
    body: { text: action, clientId: randomUUID() },
  });
  console.log(`OK ${orderNumber} ${message.sendState}`);
} else if (mode === "resume") {
  await call("POST", `/orders/${order.id}/resume-bot`, auth);
  console.log(`OK ${orderNumber} resumed`);
} else {
  const conversation = await call("GET", `/orders/${order.id}/messages`, auth);
  console.log(`OK ${orderNumber} ${statusLine(conversation)}`);
}

/**
 * `sent · silent 58m · window 23h49m` — no dates: minutes left, from the
 * API's times against this machine's clock, rounded down.
 */
function statusLine({ messages, botSilence, replyOpenUntil }) {
  const staff = messages.filter((m) => m.direction === "staff");
  const last = staff.at(-1);
  const state =
    last === undefined
      ? "no staff message"
      : last.sendState === "failed"
        ? `failed ${last.failure}`
        : last.sendState;
  const silence =
    botSilence === null
      ? "not silent"
      : `silent ${minutesLeft(botSilence.until)}m${
          botSilence.orderId === order.id ? "" : " (another order)"
        }`;
  let window = "window closed";
  if (replyOpenUntil !== null) {
    const m = minutesLeft(replyOpenUntil);
    window = `window ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
  }
  return `${state} · ${silence} · ${window}`;
}

function minutesLeft(iso) {
  return Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 60_000));
}
