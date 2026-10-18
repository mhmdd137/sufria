/**
 * A staff member writes to the order's customer (brief م-د): the field's
 * and the send's decisions, apart from React — the components only do what
 * these return, so the rules are tested without a browser.
 */
import type {
  CreateStaffMessageRequest,
  OrderMessage,
  OrderMessagesResponse,
} from "@sufria/shared";
import type { ApiResult } from "../../../shared/api/http.ts";

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

// --- the field --------------------------------------------------------------

/**
 * `WHATSAPP_TEXT_LIMIT`, written here: that constant's module (the menu's
 * message) would come to the page with it. The browser counts UTF-16 units,
 * WhatsApp characters — the field is the stricter, and the API's own count
 * refuses the rest («تعذّر الإرسال»). A test holds the two equal.
 */
export const FIELD_MAX_LENGTH = 4096;

/**
 * Enter sends with a mouse and a keyboard, Shift+Enter is a new line — as
 * WhatsApp Web (decision 5); on touch Enter is a new line and the button
 * sends. Never while an input method is composing a word.
 */
export function enterSends(key: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  /** `matchMedia("(hover: hover) and (pointer: fine)")` */
  finePointer: boolean;
}): boolean {
  return (
    key.key === "Enter" && !key.shiftKey && !key.isComposing && key.finePointer
  );
}

/**
 * The field's height to its text (brief م-د-9, decision 3): the browser
 * gives `scrollHeight` rounded to a whole pixel — the empty field's 43.25
 * (a 23.25px line and its padding) reads 43, and a box of 43 has a quarter
 * pixel to scroll, which Chrome on Windows answers with a bar and its
 * arrows. Its text can be half a pixel taller than it says: the height is
 * that, rounded up. `frame` is the borders (`offsetHeight - clientHeight`).
 */
export function fieldHeight(scrollHeight: number, frame: number): number {
  return Math.ceil(scrollHeight + 0.5) + frame;
}

/**
 * Its own overflow, set by the same effect: no scrolling while its text
 * fits in its 5 lines (`max-height`), a bar once it does not. `needed` is
 * the text's height with the borders, `scrollHeight + frame`.
 */
export function fieldOverflow(
  needed: number,
  maxHeight: number,
): "hidden" | "auto" {
  return needed > maxHeight ? "auto" : "hidden";
}

/**
 * «أرسل» is never disabled (decision 7): with nothing in the field but
 * spaces, the press puts the cursor in it and nothing else.
 */
export function sendDecision(
  draft: string,
): { kind: "focus" } | { kind: "send"; text: string } {
  const text = draft.trim();
  return text === "" ? { kind: "focus" } : { kind: "send", text };
}

/** «عدّل وأرسل»: the text in the field — after what is there, on a new line. */
export function editInto(draft: string, text: string): string {
  return draft.trim() === "" ? text : `${draft}\n${text}`;
}

/**
 * What shows under the messages (brief م-د, decisions 4 and 11): once the
 * 24 hours passed, the closed line alone; else the field — with the
 * silence line over it while the bot keeps quiet.
 */
export function replyPanel(
  res: Pick<OrderMessagesResponse, "botSilence" | "replyOpenUntil">,
): "closed" | "silent" | "open" {
  if (res.replyOpenUntil === null) return "closed";
  return res.botSilence === null ? "open" : "silent";
}

// --- the send ---------------------------------------------------------------

/** No answer, or a 5xx: the same `clientId` again after 2 s, then 6 s. */
export const SEND_RETRY_MS = [2_000, 6_000] as const;

/**
 * - `sent`: the row is written (201, or 200 for this `clientId`);
 * - `closed`: 409 `reply_window_closed`;
 * - `failed`: the network or a 5xx after the retries, a 400, a 404,
 *   `client_id_reused` — it never reached the customer's queue.
 */
export type SendOutcome = "sent" | "closed" | "failed";

/** Safe to send again: the API answers a known `clientId` with its row. */
export async function sendWithRetry(
  attempt: () => Promise<ApiResult<unknown>>,
  wait: (ms: number) => Promise<void>,
): Promise<SendOutcome> {
  for (let i = 0; ; i++) {
    const res = await attempt();
    if (res.ok) return "sent";
    const e = res.error;
    if (e.kind === "staff_conflict" && e.code === "reply_window_closed")
      return "closed";
    const again =
      e.kind === "network" || (e.kind === "http" && e.status >= 500);
    if (!again || i >= SEND_RETRY_MS.length) return "failed";
    await wait(SEND_RETRY_MS[i]!);
  }
}

/** What the conversation holds of its own, beside the server's read. */
export type ReplySnapshot = {
  local: readonly LocalStaffMessage[];
  /**
   * The text a 409 `reply_window_closed` turned back: shown, read-only,
   * over the closed line — to copy into WhatsApp.
   */
  closedText: string | null;
};

/**
 * After the API wrote a message (brief م-د-9, decision 2): the conversation
 * read every second, not every 5, until its row is no longer on its way —
 * 20 such reads at the most, then the ordinary 5 s read alone.
 */
export const FAST_READ_MS = 1_000;
export const FAST_READS_MAX = 20;

/**
 * Whether to read again in a second: a read brought one of this screen's
 * messages (`mine`, by `clientId`) still on its way on the server — the
 * API's `pending` is the database's `pending` and `sending`. A read that
 * failed (`null`) says nothing: the ordinary read carries on.
 */
export function stillSending(
  messages: readonly OrderMessage[] | null,
  mine: ReadonlySet<string>,
): boolean {
  return (
    messages?.some(
      (m) =>
        m.direction === "staff" &&
        m.sendState === "pending" &&
        mine.has(m.clientId),
    ) ?? false
  );
}

/** What the store does to the page: connected once it is on the screen. */
export type ReplyPorts = {
  send(body: CreateStaffMessageRequest): Promise<ApiResult<unknown>>;
  /** The conversation, read again at once: its messages, `null` if it failed. */
  reload(): Promise<readonly OrderMessage[] | null>;
  /** Puts a text in the field (`editInto`), the cursor in it. */
  insert(text: string): void;
};

export type ReplyOptions = {
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  /** The browser tab is in front — as `startPolling` reads it. */
  visible?: () => boolean;
};

export type Reply = {
  /**
   * The page's own calls; the store does nothing before them. Returns the
   * page's leaving: the fast read stops.
   */
  connect(ports: ReplyPorts): () => void;
  get(): ReplySnapshot;
  subscribe(listener: () => void): () => void;
  /** A text `sendDecision` let through. */
  send(text: string): Promise<SendOutcome>;
  /**
   * «عدّل وأرسل» (decision 8): the text back in the field, never sent by
   * itself. The screen's own failed bubble goes — it never reached the
   * server; a failed row of the server's stays, a record.
   */
  edit(text: string, local: string | null): void;
};

/**
 * The page's staff messages on their way (brief م-د): optimistic — the
 * bubble shows «جارٍ الإرسال…» from the press, before the request, and stays
 * until a read brings its row (`withLocal`). After the API wrote it, the
 * conversation is read at once, then every second while one of the
 * screen's rows is still on its way (`stillSending`, brief م-د-9) — one
 * clock for the page: a message written while it runs joins it, and its
 * 20 reads start again. It stops on the page's leaving and with the tab
 * hidden; the ordinary 5 s read never stops.
 */
export function createReply(options: ReplyOptions = {}): Reply {
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => newStaffClientId());
  const visible =
    options.visible ??
    (() =>
      typeof document === "undefined" ||
      document.visibilityState === "visible");
  const idle = async (): Promise<ApiResult<unknown>> => ({
    ok: false,
    error: { kind: "network" },
  });
  let ports: ReplyPorts = {
    send: idle,
    reload: async () => null,
    insert: () => undefined,
  };
  let snap: ReplySnapshot = { local: [], closedText: null };
  const listeners = new Set<() => void>();
  const set = (next: ReplySnapshot) => {
    snap = next;
    for (const l of listeners) l();
  };
  const drop = (clientId: string) =>
    snap.local.filter((l) => l.clientId !== clientId);

  // The fast read: the screen's written messages, and one clock.
  const mine = new Set<string>();
  let reads = 0;
  let following = false;
  let left = false;
  async function follow() {
    reads = 0;
    if (following) return;
    following = true;
    try {
      let messages = await ports.reload();
      while (!left && reads < FAST_READS_MAX && stillSending(messages, mine)) {
        await wait(FAST_READ_MS);
        if (left || !visible()) return;
        reads++;
        messages = await ports.reload();
      }
    } finally {
      following = false;
    }
  }

  return {
    connect(next) {
      ports = next;
      left = false;
      return () => {
        left = true;
      };
    },
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(text) {
      const clientId = newId();
      set({
        local: [
          ...snap.local,
          {
            direction: "local",
            clientId,
            text,
            at: new Date(now()).toISOString(),
            state: "pending",
          },
        ],
        closedText: null,
      });
      const outcome = await sendWithRetry(
        () => ports.send({ text, clientId }),
        wait,
      );
      if (outcome === "sent") {
        mine.add(clientId);
        await follow();
      } else if (outcome === "closed") {
        set({ local: drop(clientId), closedText: text });
        await ports.reload();
      } else
        set({
          ...snap,
          local: snap.local.map((l) =>
            l.clientId === clientId ? { ...l, state: "failed" } : l,
          ),
        });
      return outcome;
    },
    edit(text, local) {
      ports.insert(text);
      if (local !== null) set({ ...snap, local: drop(local) });
    },
  };
}

// --- «شغّل الرد الآلي» ----------------------------------------------------------

/**
 * After «شغّل الرد الآلي»: 204 → read the conversation (the line goes) · no
 * answer → the existing «انقطع الاتصال» strip · 401 → nothing, the gate
 * takes the page to login · anything else → `errors.stepFailed` under it.
 */
export function resumeOutcome(
  res: ApiResult<void>,
): "reload" | "offline" | "failed" | "none" {
  if (res.ok) return "reload";
  if (res.error.kind === "network") return "offline";
  return res.error.kind === "unauthorized" ? "none" : "failed";
}
