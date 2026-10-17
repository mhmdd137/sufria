/**
 * A staff member writes to the order's customer (brief م-د): the field's
 * and the send's decisions, apart from React — the components only do what
 * these return, so the rules are tested without a browser.
 */

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
