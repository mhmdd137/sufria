/**
 * A staff member writes to the customer (brief م-د): the screen's own
 * decisions — the message's `clientId`, the conversation's state, the
 * optimistic bubbles, the send and its retries, Enter, «عدّل وأرسل», and
 * what shows under the messages. All pure (`lib/reply.ts`, `lib/details.ts`);
 * what only a browser would show is held by reading the TSX and the CSS.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OrderMessagesResponse } from "@sufria/shared";
import { messagesReady } from "../../features/orders/lib/details.ts";
import { newStaffClientId } from "../../features/orders/lib/reply.ts";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// --- md-2: the clientId and the state ---------------------------------------

test("newStaffClientId: a UUID v4, 1000 with no repeat — and never crypto.randomUUID", (t) => {
  const spy = t.mock.method(globalThis.crypto, "randomUUID");
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = newStaffClientId();
    assert.match(id, UUID_V4);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
  assert.equal(spy.mock.callCount(), 0);
});

test("newStaffClientId: the version and variant bits are set whatever the bytes", () => {
  assert.equal(
    newStaffClientId((b) => b.fill(0xff)),
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
  );
  assert.equal(
    newStaffClientId((b) => b.fill(0)),
    "00000000-0000-4000-8000-000000000000",
  );
});

test("the conversation's state carries botSilence and replyOpenUntil with the messages", () => {
  const res: OrderMessagesResponse = {
    messages: [],
    botSilence: {
      orderId: "22222222-2222-4222-8222-222222222222",
      until: "2026-10-17T21:00:00.000Z",
    },
    replyOpenUntil: "2026-10-18T19:50:00.000Z",
  };
  assert.deepEqual(messagesReady(res), { kind: "ready", ...res });
  assert.deepEqual(
    messagesReady({ messages: [], botSilence: null, replyOpenUntil: null }),
    { kind: "ready", messages: [], botSilence: null, replyOpenUntil: null },
  );
});
