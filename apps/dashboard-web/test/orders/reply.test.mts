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
  DASHBOARD_REPLY_UI_AR,
  WHATSAPP_TEXT_LIMIT,
  clockTime,
  type CreateStaffMessageRequest,
  type CustomerOrBotMessage,
  type OrderMessage,
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
  afterSend,
  FAST_READS_MAX,
  FAST_READ_MS,
  FIELD_MAX_LENGTH,
  SEND_RETRY_MS,
  createReply,
  editInto,
  enterSends,
  fieldHeight,
  fieldOverflow,
  keyboardOpen,
  newStaffClientId,
  replyPanel,
  resumeOutcome,
  sendDecision,
  sendWithRetry,
  stillSending,
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
      return null;
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
      return null;
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

// --- md-5, md9-4: the keyboard (brief م-د-9, decisions 5 and 6) -----------

test("keyboardOpen: the cursor in the field and the viewport 120px or more shorter than the window, not by a zoom", () => {
  const at = { focused: true, innerHeight: 800, scale: 1 };
  assert.equal(keyboardOpen({ ...at, viewportHeight: 500 }), true);
  // A phone's address bar coming and going: about 60px.
  assert.equal(keyboardOpen({ ...at, viewportHeight: 740 }), false);
  assert.equal(keyboardOpen({ ...at, viewportHeight: 680 }), true);
  assert.equal(keyboardOpen({ ...at, viewportHeight: 681 }), false);
  // The back button closed it: the cursor is still in the field.
  assert.equal(keyboardOpen({ ...at, viewportHeight: 800 }), false);
});

test("keyboardOpen: no cursor in the field → closed, whatever the viewport", () => {
  assert.equal(
    keyboardOpen({
      focused: false,
      innerHeight: 800,
      viewportHeight: 500,
      scale: 1,
    }),
    false,
  );
});

test("keyboardOpen: a two-finger zoom is not a keyboard", () => {
  const at = { focused: true, innerHeight: 800, viewportHeight: 500 };
  assert.equal(keyboardOpen({ ...at, scale: 1.5 }), false);
  assert.equal(keyboardOpen({ ...at, scale: 1.01 }), true);
});

test("afterSend: on touch the cursor leaves the field; with a mouse it stays", () => {
  assert.equal(afterSend(false), "blur");
  assert.equal(afterSend(true), "keep");
  const tsx = read("staff-composer.tsx");
  // After a send alone — never on the empty press, which puts it in.
  assert.match(
    tsx,
    /onSend\(decision\.text\);\s+if \(afterSend\(matchMedia\(FINE_POINTER\)\.matches\) === "blur"\)\s+field\.current\?\.blur\(\);/,
  );
  assert.equal([...tsx.matchAll(/\.blur\(\)/g)].length, 1);
  assert.match(
    tsx,
    /const FINE_POINTER = "\(hover: hover\) and \(pointer: fine\)";/,
  );
});

test("while the keyboard is open, the step's bar is back in the page — no padding kept for it; never on the focus alone; from 1024 nothing changes", () => {
  const css = read("order-details.module.css");
  const back = rule(css, ".page[data-keyboard] .stepBar[data-fixed]");
  for (const d of [
    "position: static;",
    "padding: 0;",
    "background: none;",
    "border: 0;",
  ])
    assert.ok(back.includes(d), d);
  assert.ok(
    rule(css, ".page[data-keyboard]:has(.stepBar[data-fixed])").includes(
      "padding-block-end: 32px;",
    ),
  );
  // Decision 5 replaces brief م-د's decision 10: no :focus inside :has.
  assert.doesNotMatch(css, /textarea:focus/);
  assert.doesNotMatch(css, /:has\([^)]*:focus/);
  // Both outside any media query: the bar is fixed below 1024 alone.
  const before = css.slice(0, css.indexOf(".page[data-keyboard]"));
  assert.equal(
    (before.match(/\{/g) ?? []).length,
    (before.match(/\}/g) ?? []).length,
  );
  // The page carries the attribute; the hook reads the field in the form.
  assert.match(
    read("order-details.tsx"),
    /useKeyboard\(page\);[\s\S]*<main ref=\{page\} className=\{styles\.page\}>/,
  );
  const hook = readFileSync(
    fileURLToPath(
      new URL("../../features/orders/hooks/use-keyboard.ts", import.meta.url),
    ),
    "utf8",
  );
  assert.match(hook, /toggleAttribute\(\s*"data-keyboard"/);
  assert.match(hook, /closest\("\[data-composer\]"\)/);
  assert.match(hook, /viewport\.addEventListener\("resize", update\)/);
  assert.match(hook, /if \(el === null \|\| !viewport\) return;/);
  assert.match(read("staff-composer.tsx"), /data-composer=""/);
});

// --- md9-2: the fast read after a send (brief م-د-9, decision 2) ------------

/** A tick of the event loop: what a resolved fake leaves to run, runs. */
const settle = () => new Promise<void>((r) => setImmediate(r));

/**
 * A store whose sends are all written (201), on a fake clock: each read
 * returns `rows(n)` for the n-th read (1 the first), `wait` records its ms.
 */
function fastStore(
  rows: (n: number) => OrderMessage[] | null,
  options: {
    wait?: (ms: number) => Promise<void>;
    visible?: () => boolean;
  } = {},
) {
  const waits: number[] = [];
  let reads = 0;
  let n = 0;
  const reply = createReply({
    wait:
      options.wait ??
      (async (ms) => {
        waits.push(ms);
      }),
    now: () => Date.parse(AT),
    newId: () => `c-${++n}`,
    ...(options.visible ? { visible: options.visible } : {}),
  });
  const leave = reply.connect({
    send: async () => ok,
    reload: async () => rows(++reads),
    insert: () => {},
  });
  return {
    reply,
    leave,
    waits,
    get reads() {
      return reads;
    },
  };
}

/** The server's row of the screen's n-th message. */
const row = (n: number, sendState: StaffOrderMessage["sendState"]) =>
  staff(`s-${n}`, { clientId: `c-${n}`, sendState });

test("stillSending: one of the screen's rows `pending` (the database's pending and sending alike) — not sent, not failed, not another device's, not a failed read", () => {
  const mine = new Set(["c-1"]);
  assert.equal(stillSending([row(1, "pending")], mine), true);
  assert.equal(stillSending([row(1, "sent")], mine), false);
  assert.equal(stillSending([row(1, "failed"), customer("i-1")], mine), false);
  // Another device's message on its way: its own screen follows it.
  assert.equal(stillSending([row(2, "pending")], mine), false);
  assert.equal(stillSending(null, mine), false);
  assert.equal(stillSending([], mine), false);
});

test("written → read at once; still `pending` → again after 1000 ms, until it is `sent`", async () => {
  assert.equal(FAST_READ_MS, 1_000);
  const s = fastStore((n) => [row(1, n < 3 ? "pending" : "sent")]);
  assert.equal(await s.reply.send("مرحبا"), "sent");
  assert.equal(s.reads, 3);
  assert.deepEqual(s.waits, [1_000, 1_000]);
});

test("the API's `pending` is also the database's `sending`: read again the same way", async () => {
  // The engine claimed it (`sending`); the API answers `pending` for both.
  const s = fastStore((n) => [row(1, n === 1 ? "pending" : "sent")]);
  await s.reply.send("مرحبا");
  assert.equal(s.reads, 2);
  assert.deepEqual(s.waits, [1_000]);
});

test("`sent` on the first read → no second read; `failed` → none either", async () => {
  const sent = fastStore(() => [row(1, "sent")]);
  await sent.reply.send("مرحبا");
  assert.equal(sent.reads, 1);
  assert.deepEqual(sent.waits, []);
  const failed = fastStore((n) => [row(1, n === 1 ? "pending" : "failed")]);
  await failed.reply.send("مرحبا");
  assert.equal(failed.reads, 2);
  assert.deepEqual(failed.waits, [1_000]);
});

test("still `pending` after 20 reads at 1 s → the fast read stops (the 5 s read goes on)", async () => {
  assert.equal(FAST_READS_MAX, 20);
  // Pending for 30 reads: without the limit, it would read 31 times.
  const s = fastStore((n) => [row(1, n <= 30 ? "pending" : "sent")]);
  await s.reply.send("مرحبا");
  assert.equal(s.reads, 1 + 20);
  assert.equal(s.waits.length, 20);
});

test("a failed read → the fast read stops", async () => {
  const s = fastStore((n) => (n === 1 ? [row(1, "pending")] : null));
  await s.reply.send("مرحبا");
  assert.equal(s.reads, 2);
});

test("two messages one after the other → one clock: one read a second, never two", async () => {
  const gates: (() => void)[] = [];
  let open = 0;
  let most = 0;
  const wait = () =>
    new Promise<void>((r) => {
      most = Math.max(most, ++open);
      gates.push(() => {
        open--;
        r();
      });
    });
  const states: Record<number, StaffOrderMessage["sendState"][]> = {
    1: ["pending"],
    2: ["sent", "pending"],
    3: ["sent", "sent"],
  };
  const s = fastStore(
    (n) => (states[n] ?? ["sent", "sent"]).map((st, i) => row(i + 1, st)),
    { wait },
  );
  const first = s.reply.send("أ");
  await settle();
  assert.equal(s.reads, 1);
  assert.equal(gates.length, 1);
  // The second is written while the first is followed: it joins the clock,
  // with no read and no clock of its own.
  assert.equal(await s.reply.send("ب"), "sent");
  assert.equal(s.reads, 1);
  assert.equal(gates.length, 1);
  gates.shift()!();
  await settle();
  assert.equal(s.reads, 2);
  gates.shift()!();
  assert.equal(await first, "sent");
  assert.equal(s.reads, 3);
  assert.equal(most, 1);
});

test("the page left, or the tab hidden → the fast read stops", async () => {
  const page = { leave: () => {} };
  let waited = 0;
  const s = fastStore(() => [row(1, "pending")], {
    wait: async () => {
      if (++waited === 3) page.leave();
    },
  });
  page.leave = s.leave;
  await s.reply.send("مرحبا");
  // The read at once, two after a second; the third second ended on the leaving.
  assert.equal(s.reads, 3);

  let shown = 2;
  const hidden = fastStore(() => [row(1, "pending")], {
    visible: () => shown-- > 0,
  });
  await hidden.reply.send("مرحبا");
  assert.equal(hidden.reads, 3);
});

// --- md9-3: the field and the gap (brief م-د-9, decisions 3 and 4) ---------

test("the field's height: what scrollHeight says, half a pixel more, rounded up — the empty field's 43.25 (read 43) gets 44 inside its borders", () => {
  // Measured on Chrome at 1366 before: scrollHeight 43, the box 45 → 43
  // inside, a quarter pixel short of 23.25 + 20.
  assert.equal(fieldHeight(43, 2), 46);
  assert.ok(fieldHeight(43, 2) - 2 >= 23.25 + 20);
  // Five lines with the focus: 5 × 23.25 + 18 = 134.25, read 134.
  assert.ok(fieldHeight(134, 4) - 4 >= 5 * 23.25 + 18);
});

test("the field's overflow: hidden while its text fits in its 5 lines, auto past them", () => {
  const max = 5 * 23.25 + 22; // calc(5 * 1.55em + 22px) at 15px: 138.25
  assert.equal(fieldOverflow(43 + 2, max), "hidden");
  assert.equal(fieldOverflow(134 + 4, max), "hidden");
  assert.equal(fieldOverflow(138, max), "hidden");
  assert.equal(fieldOverflow(158 + 4, max), "auto");
  assert.equal(fieldOverflow(139, max), "auto");
});

test("the overflow is set inline by the height's effect, never in the CSS: the conversation keeps one scroll box", () => {
  const tsx = read("staff-composer.tsx");
  assert.match(
    tsx,
    /el\.style\.height = `\$\{fieldHeight\(el\.scrollHeight, frame\)\}px`;/,
  );
  assert.match(tsx, /el\.style\.overflowY = fieldOverflow\(/);
  assert.match(tsx, /getComputedStyle\(el\)\.maxHeight/);
  assert.doesNotMatch(read("staff-composer.module.css"), /overflow(-[xy])?:/);
});

test("a failed bubble and its line: 8px apart — 6px over the line and the item's 2px gap — at every width", () => {
  const css = read("conversation.module.css");
  assert.ok(rule(css, ".failure").includes("margin-block-start: 6px;"));
  assert.ok(rule(css, ".message").includes("gap: 2px;"));
  // Outside any media query.
  const before = css.slice(0, css.indexOf("\n.failure {"));
  assert.equal(
    (before.match(/\{/g) ?? []).length,
    (before.match(/\}/g) ?? []).length,
  );
});

// --- md9-5: the conversation before the order, folded (brief م-د-9, decision 7)

/** The order made at 20:00; its conversation's minute `m` (negative: before). */
const CREATED = "2026-10-17T20:00:00.000Z";
const minute = (m: number) =>
  new Date(Date.parse(CREATED) + m * 60_000).toISOString();
/** The customer and the bot in turn, `n` messages before the order. */
const before = (n: number): OrderMessage[] =>
  Array.from({ length: n }, (_, i) =>
    customer(`b-${i}`, {
      direction: i % 2 === 0 ? "inbound" : "outbound",
      at: minute(-n + i),
    }),
  );
const after = [
  customer("a-1", { at: minute(1), text: "كم بدّه وقت؟" }),
  staff("s-1", { at: minute(2) }),
];
const ids = (ms: readonly { id: string }[] | null) => ms?.map((m) => m.id);

test("nothing before the order → no line", () => {
  const view = conversationView(after, true, CREATED);
  assert.equal(view.beforeOrder, null);
  assert.deepEqual(ids(view.messages), ["a-1", "s-1"]);
});

test("3 before the order → no line: all of it shows, as it is", () => {
  const view = conversationView([...before(3), ...after], true, CREATED);
  assert.equal(view.beforeOrder, null);
  assert.deepEqual(ids(view.messages), ["b-0", "b-1", "b-2", "a-1", "s-1"]);
});

test("4 before the order → the line with 4, and they are out of the list; opened, the four in their order", () => {
  const view = conversationView([...before(4), ...after], true, CREATED);
  assert.deepEqual(ids(view.beforeOrder), ["b-0", "b-1", "b-2", "b-3"]);
  assert.deepEqual(
    view.beforeOrder!.map((m) => m.from),
    ["customer", "bot", "customer", "bot"],
  );
  assert.deepEqual(ids(view.messages), ["a-1", "s-1"]);
  const many = conversationView([...before(24), ...after], true, CREATED);
  assert.equal(many.beforeOrder!.length, 24);
});

test("a message at the order's very moment is not before it", () => {
  const at = customer("at", { direction: "outbound", at: CREATED });
  const view = conversationView([...before(4), at, ...after], true, CREATED);
  assert.deepEqual(ids(view.beforeOrder), ["b-0", "b-1", "b-2", "b-3"]);
  assert.deepEqual(ids(view.messages), ["at", "a-1", "s-1"]);
});

test("staff's never fold — a bubble of the screen's on a clock behind included", () => {
  const view = conversationView(
    withLocal(
      [...before(4), staff("s-0", { at: minute(-1) })],
      [local("c-early", { at: minute(-30) })],
    ),
    true,
    CREATED,
  );
  assert.deepEqual(ids(view.beforeOrder), ["b-0", "b-1", "b-2", "b-3"]);
  assert.deepEqual(ids(view.messages), ["s-0", "local:c-early"]);
  // No order's time: nothing folds (the conversation as before).
  assert.equal(conversationView(before(6)).beforeOrder, null);
});

test("«read» is the same folded or open: seenUpTo reads the server's messages, never the view", () => {
  // Every customer message before the order: all folded, all marked read.
  const messages = before(5);
  assert.notEqual(conversationView(messages, true, CREATED).beforeOrder, null);
  assert.equal(seenUpTo(messages, null), "b-4");
  const hook = readFileSync(
    fileURLToPath(
      new URL(
        "../../features/orders/hooks/use-order-messages.ts",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.match(hook, /const \{ messages \} = res\.value;/);
  assert.match(hook, /seenUpTo\(messages, marked\.current\)/);
});

test("the line: its text, its count in the numbers' font, «اعرضها»/«اخفِها» as the secondary button — folded on every opening, nothing kept", () => {
  const tsx = read("conversation.tsx");
  assert.match(tsx, /\{R\.orderChat\.title\}/);
  assert.match(
    tsx,
    /\{earlierCount\.before\}\s+<span className="num">\{earlierCount\.count\}<\/span>\s+\{earlierCount\.after\}/,
  );
  assert.match(
    tsx,
    /\{showEarlier \? R\.orderChat\.hide : R\.orderChat\.show\}/,
  );
  assert.match(
    tsx,
    /aria-expanded=\{showEarlier\}\s+aria-controls=\{earlierId\}/,
  );
  assert.match(tsx, /<li id=\{earlierId\} hidden=\{!showEarlier\}>/);
  assert.match(tsx, /useState\(false\);\s+const earlierId = useId\(\);/);
  assert.doesNotMatch(tsx, /localStorage|sessionStorage/);
  // At the start of the list: the line, the group, then the rest.
  assert.ok(
    tsx.indexOf("styles.fold}") < tsx.indexOf("{view.messages.map(message)}"),
  );
  assert.equal(DASHBOARD_REPLY_UI_AR.orderChat.show, "اعرضها");

  const css = read("conversation.module.css");
  const fold = rule(css, ".fold");
  for (const d of [
    "display: flex;",
    "align-items: center;",
    "flex-wrap: wrap;",
    "justify-content: flex-start;",
    "gap: 8px;",
  ])
    assert.ok(fold.includes(d), d);
  assert.doesNotMatch(fold, /border|background/);
  const title = rule(css, ".foldTitle");
  for (const d of [
    "font-size: 13px;",
    "font-weight: 600;",
    "color: var(--text-secondary);",
  ])
    assert.ok(title.includes(d), d);
  const count = rule(css, ".foldCount");
  for (const d of [
    "font-size: 13px;",
    "font-weight: 500;",
    "color: var(--text-secondary);",
  ])
    assert.ok(count.includes(d), d);
  // The button is the existing secondary one, its states and all.
  assert.match(
    tsx,
    /className=\{styles\.action\}\s+aria-expanded=\{showEarlier\}/,
  );
  // Opened, in the list's own column and gap.
  const earlier = rule(css, ".earlier");
  assert.ok(earlier.includes("gap: 10px;"));
  assert.ok(rule(css, ".messages").includes("gap: 10px;"));
});

test("the page hands the conversation its order's createdAt", () => {
  assert.match(
    read("order-details.tsx"),
    /orderCreatedAt=\{order\.state\.order\.createdAt\}/,
  );
});
