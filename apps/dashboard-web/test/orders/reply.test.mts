/**
 * A staff member writes to the customer (brief م-د): the screen's own
 * decisions — the message's `clientId`, the conversation's state, the
 * optimistic bubbles, the send and its retries, Enter, «عدّل وأرسل», and
 * what shows under the messages. All pure (`lib/reply.ts`, `lib/details.ts`);
 * what only a browser would show is held by reading the TSX and the CSS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  clockTime,
  type CustomerOrBotMessage,
  type OrderMessagesResponse,
  type StaffMessageFailure,
  type StaffOrderMessage,
} from "@sufria/shared";
import {
  conversationView,
  messagesReady,
  newCustomerMessage,
  seenUpTo,
} from "../../features/orders/lib/details.ts";
import {
  newStaffClientId,
  withLocal,
  type LocalStaffMessage,
} from "../../features/orders/lib/reply.ts";

const COMPONENTS = fileURLToPath(
  new URL("../../features/orders/components/", import.meta.url),
);
const read = (file: string) => readFileSync(`${COMPONENTS}${file}`, "utf8");

/** The declarations of one CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

const AT = "2026-10-17T20:00:00.000Z";

const customer = (
  id: string,
  extra: Partial<CustomerOrBotMessage> = {},
): CustomerOrBotMessage => ({
  id,
  direction: "inbound",
  kind: "text",
  text: "وين طلبي؟",
  location: null,
  at: AT,
  ...extra,
});

const staff = (
  id: string,
  extra: Partial<StaffOrderMessage> = {},
): StaffOrderMessage => ({
  id,
  direction: "staff",
  kind: "text",
  text: "طلبك بعد 10 دقايق",
  location: null,
  at: AT,
  sendState: "sent",
  failure: null,
  staffName: "أحمد",
  clientId: `c-${id}`,
  ...extra,
});

const local = (
  clientId: string,
  extra: Partial<LocalStaffMessage> = {},
): LocalStaffMessage => ({
  direction: "local",
  clientId,
  text: "مرحبا، معك المطعم",
  at: AT,
  state: "pending",
  ...extra,
});

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

// --- md-3: the staff message in the conversation ---------------------------

test("a staff message is staff's, at the bot's end — sent: «الاسم · الوقت», no action", () => {
  const [m] = conversationView([staff("s1")]).messages;
  assert.equal(m!.from, "staff");
  assert.equal(m!.text, "طلبك بعد 10 دقايق");
  assert.deepEqual(m!.staff, {
    state: "sent",
    meta: { before: "أحمد · ", time: clockTime(AT), after: "" },
    note: null,
    action: null,
    local: null,
  });
  // The account gone: the time alone.
  const [gone] = conversationView([staff("s2", { staffName: null })]).messages;
  assert.deepEqual(gone!.staff!.meta, {
    before: "",
    time: clockTime(AT),
    after: "",
  });
});

test("pending — the server's, or the screen's own bubble: «جارٍ الإرسال…»", () => {
  const view = conversationView([
    staff("s1", { sendState: "pending" }),
    local("c-9"),
  ]);
  for (const m of view.messages) {
    assert.equal(m.from, "staff");
    assert.equal(m.staff!.state, "pending");
    assert.equal(m.staff!.note, "جارٍ الإرسال…");
    assert.equal(m.staff!.meta, null);
    assert.equal(m.staff!.action, null);
  }
  assert.equal(view.messages[0]!.staff!.local, null);
  assert.equal(view.messages[1]!.staff!.local, "c-9");
  assert.equal(view.messages[1]!.id, "local:c-9");
});

test("failed: each of the four reasons its line and its action; the screen's own reads «تعذّر الإرسال» with «عدّل وأرسل»", () => {
  const cases: [StaffMessageFailure, string, "edit" | "contact" | null][] = [
    ["send_failed", "لم تُرسل: تعذّر الإرسال.", "edit"],
    ["expired", "لم تُرسل: تأخّرت أكثر من دقيقتين، فأوقفناها.", "edit"],
    [
      "window_closed",
      "لم تُرسل: مرّت 24 ساعة على آخر رسالة من الزبون.",
      "contact",
    ],
    ["no_sender_number", "لم تُرسل: رقم واتساب المطعم غير مربوط.", null],
  ];
  for (const [failure, note, action] of cases) {
    const [m] = conversationView([
      staff("s", { sendState: "failed", failure }),
    ]).messages;
    assert.deepEqual(
      [m!.staff!.state, m!.staff!.note, m!.staff!.action, m!.staff!.meta],
      ["failed", note, action, null],
      failure,
    );
  }
  const [mine] = conversationView([local("c-1", { state: "failed" })]).messages;
  assert.deepEqual(
    [mine!.staff!.state, mine!.staff!.note, mine!.staff!.action],
    ["failed", "لم تُرسل: تعذّر الإرسال.", "edit"],
  );
});

test("once the 24 hours passed, a failed one offers «راسل الزبون» — there is no field to edit in", () => {
  const view = conversationView(
    [
      staff("s", { sendState: "failed", failure: "expired" }),
      local("c-1", { state: "failed" }),
      staff("n", { sendState: "failed", failure: "no_sender_number" }),
    ],
    false,
  );
  assert.deepEqual(
    view.messages.map((m) => m.staff!.action),
    ["contact", "contact", null],
  );
});

test("a staff message is never folded, however long", () => {
  const long = Array.from({ length: 9 }, () => "سطر").join("\n");
  const [m] = conversationView([staff("s", { text: long })]).messages;
  assert.equal(m!.preview, null);
  assert.equal(m!.text, long);
});

test("the merge: a local bubble and the server's row with its clientId are one — by clientId, never id", () => {
  // The server's row has its own id; only the clientId ties it to the bubble.
  const row = staff("srv-1", { clientId: "c-1", sendState: "pending" });
  assert.deepEqual(withLocal([row], [local("c-1")]), [row]);
  // A local bubble whose id-like string matches a row's id is not that row.
  assert.equal(withLocal([staff("c-2")], [local("c-2")]).length, 2);
});

test("the merge: a bubble the server has not returned stays, after the server's messages, in the order sent", () => {
  const first = local("c-a", { at: "2026-10-17T20:00:01.000Z" });
  const second = local("c-b", { at: "2026-10-17T20:00:02.000Z" });
  const later = customer("in-1", { at: "2026-10-17T20:00:05.000Z" });
  assert.deepEqual(withLocal([later], [second, first]), [later, first, second]);
});

test("a staff message is not the customer's: no «رسائل الزبون فقط», no ring, never «read»", () => {
  assert.equal(conversationView([customer("in-1"), staff("s1")]).notice, null);
  assert.equal(conversationView([staff("s1")]).notice, null);
  // A read that brings a staff message alone rings nothing.
  assert.equal(
    newCustomerMessage([customer("in-1")], [customer("in-1"), staff("s1")]),
    false,
  );
  // «Read» stays the customer's latest, whatever staff wrote after it.
  assert.equal(seenUpTo([customer("in-1"), staff("s1")], null), "in-1");
});

test("the staff bubble's look (§3): dashed while it goes, filled once sent, 2px and a pixel less padding when failed", () => {
  const css = read("conversation.module.css");
  const base = rule(css, '.message[data-from="staff"] .bubble');
  assert.match(base, /background: var\(--surface\);/);
  assert.match(base, /border: 1px dashed var\(--text-primary\);/);
  const sent = rule(css, '.message[data-state="sent"] .bubble');
  assert.match(sent, /background: var\(--staff-bubble\);/);
  assert.match(sent, /color: var\(--on-staff-bubble\);/);
  assert.match(sent, /border: 1px solid var\(--staff-bubble\);/);
  const failed = rule(css, '.message[data-state="failed"] .bubble');
  assert.match(failed, /border: 2px solid var\(--text-primary\);/);
  assert.match(failed, /padding: 7px 11px;/);
  // At the bot's end.
  assert.match(
    css,
    /\.message\[data-from="bot"\],\n\.message\[data-from="staff"\] \{\n  align-self: flex-end;/,
  );
  const action = rule(css, ".action");
  for (const d of [
    "min-height: 44px;",
    "padding-inline: 14px;",
    "border-radius: 8px;",
    "font-size: 13px;",
    "font-weight: 600;",
  ])
    assert.ok(action.includes(d), d);
  const tsx = read("conversation.tsx");
  assert.match(tsx, /data-state=\{m\.staff\?\.state\}/);
  // The time under it in the numbers' font.
  assert.match(tsx, /className=\{`num \$\{styles\.metaTime\}`\}/);
});
