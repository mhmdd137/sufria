/**
 * Demo script: the restaurant's payment method through the API, as the
 * settings screen will set it (brief م-هـ-أ §10).
 *
 * 🔴 A development tool — **never with a real restaurant.** The settings
 *    screen is a later brief; until it is built, this stands in for it on the
 *    laptop.
 *
 *   node --env-file=.env scripts/demo-payment.mjs show
 *   node --env-file=.env scripts/demo-payment.mjs cash
 *   node --env-file=.env scripts/demo-payment.mjs transfer "<details>"
 *
 * Through `PATCH /restaurant/settings`, never the database: the details are
 * cleaned and checked exactly as the screen's will be. `cash` keeps the
 * saved details; `transfer` with none sent and none saved is a 400.
 *
 * Reads `DEMO_STAFF_EMAIL` and `DEMO_STAFF_PASSWORD` from `.env` and never
 * prints them, nor the token — **nor the details** (the restaurant's
 * wallet): their length alone. One line out:
 *   OK cash
 *   OK transfer · 33 chars
 *   FAIL <code> <reason>
 */
function fail(code, reason) {
  console.log(`FAIL ${code} ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refused", "demo script is not for production");
}

const USAGE =
  'node --env-file=.env scripts/demo-payment.mjs (show | cash | transfer "<details>")';

const [action, details, ...extra] = process.argv.slice(2);
if (
  extra.length > 0 ||
  !["show", "cash", "transfer"].includes(action) ||
  (action === "transfer") !== (details !== undefined)
) {
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

const settings =
  action === "show"
    ? await call("GET", "/restaurant/settings", auth)
    : await call("PATCH", "/restaurant/settings", {
        ...auth,
        body:
          action === "cash"
            ? { paymentMethod: "cash" }
            : { paymentMethod: "transfer", transferDetails: details },
      });

console.log(
  settings.paymentMethod === "transfer"
    ? `OK transfer · ${[...(settings.transferDetails ?? "")].length} chars`
    : "OK cash",
);
