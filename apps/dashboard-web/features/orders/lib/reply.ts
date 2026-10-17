/**
 * A staff member writes to the order's customer (brief م-د): the field's
 * and the send's decisions, apart from React — the components only do what
 * these return, so the rules are tested without a browser.
 */
import type { OrderMessage } from "@sufria/shared";

/**
 * The message's `clientId` (brief م-ج, `CreateStaffMessageRequest`): a UUID
 * v4 from `crypto.getRandomValues` — never `crypto.randomUUID()`, which
 * exists on HTTPS and localhost alone, and the dashboard opens from another
 * device on the network before it is hosted.
 */
export function newStaffClientId(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const b = random(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A staff message the screen sent, as the screen shows it until the
 * conversation's read brings its row (brief م-د, optimistic): `pending`
 * from the press, `failed` when it never reached the API — the network, a
 * 5xx after its retries, a 400, a 404, `client_id_reused`.
 */
export type LocalStaffMessage = {
  direction: "local";
  clientId: string;
  text: string;
  /** When staff pressed «أرسل», on this device's clock. */
  at: string;
  state: "pending" | "failed";
};

/** What the conversation shows: the server's messages and the screen's own. */
export type ShownMessage = OrderMessage | LocalStaffMessage;

/**
 * The server's messages, then the screen's own bubbles in the order they
 * were sent — less each one whose row came back (by `clientId`, never `id`:
 * a local bubble has no `id` of the server's).
 */
export function withLocal(
  server: readonly OrderMessage[],
  local: readonly LocalStaffMessage[],
): ShownMessage[] {
  const known = new Set(
    server.flatMap((m) => (m.direction === "staff" ? [m.clientId] : [])),
  );
  const mine = local
    .filter((l) => !known.has(l.clientId))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return [...server, ...mine];
}
