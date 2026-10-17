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
  WHATSAPP_TEXT_LIMIT,
  clockTime,
  type CreateStaffMessageRequest,
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
  FIELD_MAX_LENGTH,
  SEND_RETRY_MS,
  createReply,
  editInto,
  enterSends,
  newStaffClientId,
  replyPanel,
  resumeOutcome,
  sendDecision,
  sendWithRetry,
  withLocal,
  type LocalStaffMessage,
} from "../../features/orders/lib/reply.ts";
import type { ApiResult } from "../../shared/api/http.ts";

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

// --- md-4: the field, the line, the closed state ----------------------------

const key = (extra: Partial<Parameters<typeof enterSends>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  finePointer: true,
  ...extra,
});

test("Enter: sends with a mouse and keyboard; Shift+Enter, touch and a composing word do not", () => {
  assert.equal(enterSends(key()), true);
  assert.equal(enterSends(key({ shiftKey: true })), false);
  assert.equal(enterSends(key({ finePointer: false })), false);
  assert.equal(enterSends(key({ isComposing: true })), false);
  assert.equal(enterSends(key({ key: "a" })), false);
});

test("«أرسل» with nothing but spaces: the cursor in the field, nothing sent; else the text trimmed", () => {
  assert.deepEqual(sendDecision(""), { kind: "focus" });
  assert.deepEqual(sendDecision("  \n "), { kind: "focus" });
  assert.deepEqual(sendDecision("  مرحبا\nمعك المطعم "), {
    kind: "send",
    text: "مرحبا\nمعك المطعم",
  });
});

type Reply = ApiResult<unknown>;
const ok: Reply = { ok: true, value: {} };
const network: Reply = { ok: false, error: { kind: "network" } };
const http = (status: number): Reply => ({
  ok: false,
  error: { kind: "http", status },
});
const closed: Reply = {
  ok: false,
  error: { kind: "staff_conflict", code: "reply_window_closed" },
};
const reused: Reply = {
  ok: false,
  error: { kind: "staff_conflict", code: "client_id_reused" },
};

function attempts(replies: Reply[]) {
  const waits: number[] = [];
  let calls = 0;
  return {
    attempt: async () => {
      calls++;
      return replies.shift()!;
    },
    wait: async (ms: number) => {
      waits.push(ms);
    },
    get calls() {
      return calls;
    },
    waits,
  };
}

test("the retries: no answer three times — after 2 s and 6 s — then failed", async () => {
  const a = attempts([network, network, network]);
  assert.equal(await sendWithRetry(a.attempt, a.wait), "failed");
  assert.equal(a.calls, 3);
  assert.deepEqual(a.waits, [2_000, 6_000]);
  assert.deepEqual(SEND_RETRY_MS, [2_000, 6_000]);
});

test("the retries: a 5xx is tried again, and the next answer counts", async () => {
  const a = attempts([http(502), ok]);
  assert.equal(await sendWithRetry(a.attempt, a.wait), "sent");
  assert.deepEqual(a.waits, [2_000]);
});

test("the retries: 400 · 404 · client_id_reused fail at once; 409 reply_window_closed is closed", async () => {
  for (const r of [http(400), http(404), reused]) {
    const a = attempts([r]);
    assert.equal(await sendWithRetry(a.attempt, a.wait), "failed");
    assert.equal(a.calls, 1);
  }
  const a = attempts([closed]);
  assert.equal(await sendWithRetry(a.attempt, a.wait), "closed");
  assert.equal(a.calls, 1);
});

/** A store on fakes: what it sent, read and put in the field. */
function store(replies: Reply[]) {
  const sent: CreateStaffMessageRequest[] = [];
  const inserted: string[] = [];
  let reloads = 0;
  let n = 0;
  const reply = createReply({
    wait: async () => {},
    now: () => Date.parse(AT),
    newId: () => `c-${++n}`,
  });
  reply.connect({
    send: async (body) => {
      sent.push(body);
      return replies.shift()!;
    },
    reload: async () => {
      reloads++;
    },
    insert: (text) => inserted.push(text),
  });
  return {
    reply,
    sent,
    inserted,
    get reloads() {
      return reloads;
    },
  };
}

test("the send is optimistic: «جارٍ الإرسال…» before the answer; written → the conversation read at once", async () => {
  let answer!: (r: Reply) => void;
  const reply = createReply({ newId: () => "c-1", now: () => Date.parse(AT) });
  let reloads = 0;
  reply.connect({
    send: () => new Promise((r) => (answer = r)),
    reload: async () => {
      reloads++;
    },
    insert: () => {},
  });
  const done = reply.send("مرحبا");
  assert.deepEqual(reply.get().local, [local("c-1", { text: "مرحبا" })]);
  answer(ok);
  assert.equal(await done, "sent");
  assert.equal(reloads, 1);
  // The bubble stays until a read brings its row (withLocal drops it then).
  assert.equal(reply.get().local.length, 1);
});

test("a send that never got through: the bubble failed, «تعذّر الإرسال» and «عدّل وأرسل»", async () => {
  const s = store([network, network, network]);
  assert.equal(await s.reply.send("مرحبا"), "failed");
  assert.deepEqual(s.sent, [
    { text: "مرحبا", clientId: "c-1" },
    { text: "مرحبا", clientId: "c-1" },
    { text: "مرحبا", clientId: "c-1" },
  ]);
  assert.deepEqual(s.reply.get().local, [
    local("c-1", { text: "مرحبا", state: "failed" }),
  ]);
  const [m] = conversationView(withLocal([], s.reply.get().local)).messages;
  assert.equal(m!.staff!.note, "لم تُرسل: تعذّر الإرسال.");
  assert.equal(m!.staff!.action, "edit");
});

test("409 reply_window_closed: the bubble goes, the text kept read-only, read again → the closed line", async () => {
  const s = store([closed]);
  assert.equal(await s.reply.send("طلبك بعد 10 دقايق"), "closed");
  assert.deepEqual(s.reply.get(), {
    local: [],
    closedText: "طلبك بعد 10 دقايق",
  });
  assert.equal(s.reloads, 1);
  // The read that follows says the window passed: the closed line.
  assert.equal(
    replyPanel({ botSilence: null, replyOpenUntil: null }),
    "closed",
  );
  // The next send clears it.
  const t = store([closed, ok]);
  await t.reply.send("أ");
  await t.reply.send("ب");
  assert.equal(t.reply.get().closedText, null);
});

test("«عدّل وأرسل»: the text in the field — never sent by itself; the screen's own bubble goes, the server's failed row stays", async () => {
  assert.equal(editInto("", "طلبك بعد 10 دقايق"), "طلبك بعد 10 دقايق");
  assert.equal(editInto("  ", "طلبك"), "طلبك");
  assert.equal(editInto("مرحبا", "طلبك"), "مرحبا\nطلبك");

  const s = store([http(400)]);
  // A failed bubble of the screen's own, there before.
  await s.reply.send("أ");
  const mine = s.reply.get().local[0]!;
  assert.equal(mine.state, "failed");
  s.reply.edit(mine.text, mine.clientId);
  assert.deepEqual(s.inserted, ["أ"]);
  assert.deepEqual(s.reply.get().local, []);
  assert.equal(s.sent.length, 1, "edit sent nothing of its own");

  // A failed row of the server's: put in the field, and nothing goes.
  const t = store([]);
  t.reply.edit("طلبك بعد 10 دقايق", null);
  assert.deepEqual(t.inserted, ["طلبك بعد 10 دقايق"]);
  assert.deepEqual(t.reply.get().local, []);
  assert.equal(t.sent.length, 0);
  const row = staff("s1", { sendState: "failed", failure: "expired" });
  assert.equal(withLocal([row], t.reply.get().local).length, 1);
});

test("what shows under the messages: closed once replyOpenUntil is null; the line only while the bot keeps quiet", () => {
  const until = "2026-10-17T21:00:00.000Z";
  const silence = { orderId: "o", until };
  assert.equal(
    replyPanel({ botSilence: null, replyOpenUntil: null }),
    "closed",
  );
  // Closed beats the silence: no line after the 24 hours.
  assert.equal(
    replyPanel({ botSilence: silence, replyOpenUntil: null }),
    "closed",
  );
  assert.equal(replyPanel({ botSilence: null, replyOpenUntil: until }), "open");
  assert.equal(
    replyPanel({ botSilence: silence, replyOpenUntil: until }),
    "silent",
  );
});

test("«شغّل الرد الآلي»: 204 reads again · no answer → the offline strip · 401 nothing · else «لا يمكن تنفيذ هذه الخطوة الآن.»", () => {
  assert.equal(resumeOutcome({ ok: true, value: undefined }), "reload");
  assert.equal(
    resumeOutcome({ ok: false, error: { kind: "network" } }),
    "offline",
  );
  assert.equal(
    resumeOutcome({ ok: false, error: { kind: "unauthorized" } }),
    "none",
  );
  assert.equal(
    resumeOutcome({ ok: false, error: { kind: "http", status: 404 } }),
    "failed",
  );
  const tsx = read("conversation.tsx");
  assert.match(tsx, /\{T\.errors\.stepFailed\}/);
  assert.match(tsx, /aria-busy=\{busy\}/);
});

test("the field: dir auto, 4096 at most, its placeholder its name; «أرسل» never disabled, never takes the focus", () => {
  assert.equal(FIELD_MAX_LENGTH, WHATSAPP_TEXT_LIMIT);
  const tsx = read("staff-composer.tsx");
  assert.match(
    tsx,
    /placeholder=\{R\.placeholder\}\s+aria-label=\{R\.placeholder\}/,
  );
  assert.match(tsx, /dir="auto"/);
  assert.match(tsx, /maxLength=\{FIELD_MAX_LENGTH\}/);
  assert.doesNotMatch(tsx, /disabled[={]/);
  assert.match(tsx, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(tsx, /data-composer=""/);
});

test("the field's look (§3): bg, 1px line, 8 radius, 15/1.55, 10×12 — with the focus 2px text-primary and 9×11; 5 lines then it scrolls", () => {
  const css = read("staff-composer.module.css");
  const input = rule(css, ".input");
  for (const d of [
    "background: var(--bg);",
    "border: 1px solid var(--border);",
    "border-radius: 8px;",
    "font-size: 15px;",
    "line-height: 1.55;",
    "padding: 10px 12px;",
    "min-height: 44px;",
    "max-height: calc(5 * 1.55em + 22px);",
    "resize: none;",
    "color: var(--text-primary);",
  ])
    assert.ok(input.includes(d), d);
  const focus = rule(css, ".input:focus");
  assert.ok(focus.includes("border: 2px solid var(--text-primary);"));
  assert.ok(focus.includes("padding: 9px 11px;"));
  assert.ok(
    rule(css, ".input::placeholder").includes("color: var(--text-secondary);"),
  );
  const send = rule(css, ".send");
  for (const d of [
    "background: var(--text-primary);",
    "color: var(--bg);",
    "border: 0;",
    "border-radius: 8px;",
    "min-height: 44px;",
    "padding-inline: 20px;",
    "font-size: 15px;",
    "font-weight: 600;",
  ])
    assert.ok(send.includes(d), d);
  // Below 640 the button under the field, at the start; from 640 one line.
  assert.match(
    rule(css, ".composer"),
    /grid-template-areas:\s+"field"\s+"send";/,
  );
  assert.match(
    css,
    /@media \(min-width: 640px\) \{\n  \.composer \{[^}]*grid-template-areas: "field send";[^}]*align-items: end;/,
  );
});

test("the silence line and the closed line (§3): their lines, sizes and buttons; the time in the numbers' font", () => {
  const css = read("conversation.module.css");
  const silence = rule(css, ".silence");
  assert.ok(silence.includes("padding-block-start: 12px;"));
  assert.ok(silence.includes("border-block-start: 1px solid var(--border);"));
  const text = rule(css, ".silenceText");
  assert.ok(text.includes("font-size: 13px;"));
  assert.ok(text.includes("color: var(--text-secondary);"));
  const button = rule(css, ".lineButton");
  for (const d of [
    "min-height: 44px;",
    "padding-inline: 16px;",
    "font-size: 15px;",
  ])
    assert.ok(button.includes(d), d);
  const closedRule = rule(css, ".closed");
  assert.ok(
    closedRule.includes("border-block-start: 1px solid var(--border);"),
  );
  const note = rule(css, ".closedNote");
  assert.ok(note.includes("max-width: 460px;"));
  assert.ok(note.includes("font-size: 15px;"));
  const tsx = read("conversation.tsx");
  assert.match(tsx, /role="status"/);
  assert.match(
    tsx,
    /\{line\.before\}\s+<span className=\{`num \$\{styles\.metaTime\}`\}>\{line\.time\}<\/span>/,
  );
  assert.match(tsx, /readOnly/);
  assert.ok(rule(css, ".metaTime").includes("font-weight: 500;"));
});

// --- md-5: the keyboard ------------------------------------------------------

test("while the field has the focus, the step's bar is back in the page — no padding kept for it; from 1024 nothing changes", () => {
  const css = read("order-details.module.css");
  const back = rule(
    css,
    ".page:has([data-composer] textarea:focus) .stepBar[data-fixed]",
  );
  for (const d of [
    "position: static;",
    "padding: 0;",
    "background: none;",
    "border: 0;",
  ])
    assert.ok(back.includes(d), d);
  assert.ok(
    rule(
      css,
      ".page:has(.stepBar[data-fixed]):has([data-composer] textarea:focus)",
    ).includes("padding-block-end: 32px;"),
  );
  // Both outside any media query: the bar is fixed below 1024 alone.
  const before = css.slice(
    0,
    css.indexOf(".page:has([data-composer] textarea:focus)"),
  );
  assert.equal(
    (before.match(/\{/g) ?? []).length,
    (before.match(/\}/g) ?? []).length,
  );
  // The field is the one inside the form that carries the attribute.
  assert.match(read("staff-composer.tsx"), /data-composer=""/);
});
