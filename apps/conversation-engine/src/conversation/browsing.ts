import {
  CART_EMPTY_AR,
  CART_EMPTY_ON_FINISH_AR,
  FINISH_HINT_AR,
  fulfillmentAskAr,
  type SummaryFulfillment,
  HANDOFF_STREAK,
  MAX_QTY_PER_ITEM,
  NOTE_HINT_AR,
  NOTE_MAX_LENGTH,
  NOTE_TOO_LONG_AR,
  cleanNote,
  handoffMessageAr,
  isReplyWord,
  joinNotes,
  matchCommand,
  matchOrderCommand,
  normalizeArabic,
  noteAddedAr,
  interpretMessage,
  itemNotInCartAr,
  itemsAddedLinesAr,
  itemsUnavailableLineAr,
  nextUnparsedStreak,
  nothingUnderstoodAr,
  noteKey,
  noteLength,
  noteTooLongItemAr,
  noteWithoutName,
  overCapLineAr,
  parseItems,
  unclearPartsLineAr,
  unknownNumbersLineAr,
  type CustomerCommand,
  type Currency,
  type SummaryPayment,
  type MessageIntent,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import { readCatalog, type Catalog } from "../restaurant/catalog.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { advanceSessionState } from "../db/critical-primitives.js";
import { cartTotalMinor, renderCart, renderSummary } from "./cart-view.js";
import { deliverMenu, prepareMenu } from "./menu-delivery.js";
import { replyOrdersPaused } from "./orders-paused.js";
import {
  readSessionData,
  toSummaryFulfillment,
  writeSessionData,
  type CartLine,
  type LastAdded,
  type SessionData,
  type StoredReorder,
} from "./session-data.js";

/**
 * رسالة من زبون جلسته بحالة `browsing` — ب-4.
 *
 * الشكل: قشرة رفيعة فيها كل الـI/O، وقرار صافٍ بالنص (`decideBrowsing`) ما
 * بيلمس قاعدة ولا شبكة. القرار بياخد الحالة ويرجّع الحالة الجاية والرد.
 *
 * ⛔ «تم» مش هون — ب-5. هون بيصفّر العدّاد وبس، بلا رد (§14.7).
 */

// ---------------------------------------------------------------------------
// القرار — صافٍ
// ---------------------------------------------------------------------------

/**
 * The intent as `decideBrowsing` gets it: the shared parser's, with «نفسه»
 * resolved first by `interpretBrowsing` (brief ك).
 *
 * 🔴 `command` never carries "reorder" here, by its type. «نفسه» arrives
 *    either as `reorder` — its two conditions held, and the suggestion is
 *    in hand — or as plain text, on today's path.
 */
export type BrowsingIntent =
  | Exclude<MessageIntent, { readonly kind: "command" }>
  | {
      readonly kind: "command";
      readonly command: Exclude<CustomerCommand, "reorder">;
    }
  | { readonly kind: "reorder"; readonly reorder: StoredReorder };

/**
 * «نفسه» means something only when **both** hold (brief ك): the session
 * keeps a suggestion (`context.reorder`, written with the first message),
 * and the cart is empty. The state, `browsing`, is the caller's: only this
 * handler reads the word at all.
 */
export function reorderApplies(
  data: SessionData,
): data is SessionData & { reorder: StoredReorder } {
  return data.reorder !== undefined && data.cart.length === 0;
}

/**
 * The message as `browsing` reads it.
 *
 * 🔴 «نفسه» and its sister words (`REORDER_INPUTS`) without their two
 *    conditions are read as plain text — the parser, then the hint and the
 *    unparsed streak, exactly as before brief ك. So no existing behavior
 *    changes: a word that means nothing here is answered as it always was.
 */
export function interpretBrowsing(
  raw: string,
  data: SessionData,
): BrowsingIntent {
  const intent = interpretMessage(raw, data.menu_map);
  if (intent.kind !== "command") return intent;
  const { command } = intent;
  if (command === "reorder") {
    return reorderApplies(data)
      ? { kind: "reorder", reorder: data.reorder }
      : { kind: "items", result: parseItems(raw, data.menu_map) };
  }
  return { kind: "command", command };
}

export interface BrowsingDecision {
  readonly next: SessionData;
  /** الرد النصي، أو `null` = صمت. */
  readonly reply: string | null;
  /** «منيو»: القشرة بتعيد إرسال القائمة عبر `deliverMenu` — والخريطة معها. */
  readonly resendMenu: boolean;
  /**
   * «تم» وسلّة فيها أصناف: القشرة بتعمل CAS من `browsing` للحالة هاي **قبل**
   * ما تكتب وتبعت. خسارة الـCAS = تجاهل صامت (ب-5). `null` = ولا انتقال.
   *
   * 🔴 صارت حالة بدل `boolean` بج-3: «تم» ما عادت بتوصّل لمكان واحد. المطعم
   *    اللي بيوصّل بيوقّف الزبون عند سؤال الاستلام (`fulfillment_choice`)،
   *    واللي ما بيوصّل بيفوت على الملخّص رأسا (`cart_review`) — ج §3.
   */
  readonly advanceTo: "cart_review" | "fulfillment_choice" | null;
}

export interface BrowsingInput {
  readonly data: SessionData;
  readonly intent: BrowsingIntent;
  /** الأصناف اللي ذكرتها الرسالة، مقروءة حيّا لحظة المعالجة. */
  readonly catalog: Catalog;
  /** `restaurants.contact_phone`. `null` = الاستسلام صامت تماما (§11.3). */
  readonly contactPhone: string | null;
  /**
   * `restaurants.offers_delivery` — **قدرة المطعم، مش اختيار الطلب** (ج §2.4).
   * 🔴 بينقرا **حيّا لحظة «تم»** (ج §3)، مش من الجلسة: مطعم طفّى التوصيل
   *    بينطبّق عليه القرار من أول «تم» جاية، بلا ما تنتظر جلسة جديدة.
   */
  readonly offersDelivery: boolean;
  /** `restaurants.delivery_fee` بالقروش — بينعمله snapshot عند اختيار «توصيل». */
  readonly deliveryFeeMinor: number;
  /** `restaurants.currency` — لكل نص فيه مبلغ (بريف د §2.2). */
  readonly currency: Currency;
  /**
   * `restaurants.payment_method` — the summary's payment line, «الدفع
   * نقدا.» or ن1 (brief م-هـ-أ §5). Read with every message, like the
   * currency.
   */
  readonly payment: SummaryPayment;
  /** The message's text as written — `""` for an image or a voice note. */
  readonly body: string;
}

/** كل رد صادر بينعدّ — فجوة القياس بـ§4. الصمت ما بينعدّ. */
function withReply(
  next: SessionData,
  reply: string | null,
  advanceTo: BrowsingDecision["advanceTo"] = null,
): BrowsingDecision {
  return reply === null
    ? { next, reply: null, resendMenu: false, advanceTo }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        resendMenu: false,
        advanceTo,
      };
}

/** What a message with no item number does with «آخر إضافة» (brief ن §5). */
export type StuckNote =
  /** It stuck: the cart moved, ن3 is the reply, «آخر إضافة» is kept. */
  | {
      readonly kind: "stuck";
      readonly cart: CartLine[];
      readonly lastAdded: LastAdded[];
      readonly reply: string;
    }
  /** ن4ب: the note alone, or joined to the one there, is over the limit. */
  | { readonly kind: "too-long" }
  /** It is no note: today's reply. */
  | { readonly kind: "none" };

/**
 * A message with no item number, as a note for the pieces the last message
 * added (brief ن §5, decision 3) — **pure**.
 *
 * Every condition, or no note: the message is no command (of browsing or of
 * the steps after it), no word of reply (§2.4), not empty once normalized
 * (an emoji, an image), and «آخر إضافة» holds **exactly one** line. Why one:
 * every number is one more piece, so a customer told to send «2 بدون بصل»
 * again gets two sandwiches — a note must stick to the one thing just added.
 *
 * Then, by Claude's decisions on the brief:
 * - the note is the raw message cleaned, the item's name off it (§2.3); a
 *   note there already: «القديمة، الجديدة», and over 100 is ن4ب, nothing
 *   changed;
 * - 🔴 **the note goes to the pieces the last message added alone** — when
 *   «2» added to a line already in the cart, that line keeps its other
 *   pieces: it loses `qty`, and (item, new note) gains them, at the line's
 *   own price (the same pieces, not today's);
 * - those pieces stay «آخر إضافة», with their new note.
 */
export function stickNote(
  data: SessionData,
  lastAdded: readonly LastAdded[],
  body: string,
): StuckNote {
  if (lastAdded.length !== 1) return { kind: "none" };
  if (matchCommand(body) !== null || matchOrderCommand(body) !== null) {
    return { kind: "none" };
  }
  if (isReplyWord(body) || normalizeArabic(body) === "") {
    return { kind: "none" };
  }
  const [last] = lastAdded as [LastAdded];
  const at = data.cart.findIndex(
    (l) =>
      l.item_id === last.item_id &&
      noteKey(l.note) === noteKey(last.note) &&
      l.qty >= last.qty,
  );
  const source = data.cart[at];
  if (source === undefined) return { kind: "none" };

  const cleaned = cleanNote(body);
  const added = cleaned === null ? null : noteWithoutName(cleaned, source.name);
  if (added === null) return { kind: "none" };
  const note = last.note === null ? added : joinNotes(last.note, added);
  if (noteLength(note) > NOTE_MAX_LENGTH) return { kind: "too-long" };

  const cart = [...data.cart];
  if (source.qty === last.qty) cart.splice(at, 1);
  else cart[at] = { ...source, qty: source.qty - last.qty };
  const into = cart.findIndex(
    (l) => l.item_id === last.item_id && noteKey(l.note) === noteKey(note),
  );
  const target = cart[into];
  let kept: string;
  if (target !== undefined) {
    cart[into] = { ...target, qty: target.qty + last.qty };
    kept = target.note ?? note;
  } else {
    // Where the pieces were: in the line's place, or right after it.
    const place = source.qty === last.qty ? at : at + 1;
    cart.splice(place, 0, { ...source, qty: last.qty, note });
    kept = note;
  }
  return {
    kind: "stuck",
    cart,
    lastAdded: [{ item_id: last.item_id, note: kept, qty: last.qty }],
    reply: noteAddedAr(source.name, last.qty, kept),
  };
}

/**
 * ن5 goes on a reply (brief ن §3) only with a cart, never for a word of reply
 * or an empty message, and once in the session — nor for a command word read
 * as plain text («نفسه» without its conditions, «اكد» in browsing): those
 * are answered exactly as before (brief ك).
 */
function noteHintDue(
  data: SessionData,
  cart: readonly CartLine[],
  body: string,
): boolean {
  return (
    !data.note_hint_sent &&
    cart.length > 0 &&
    !isReplyWord(body) &&
    normalizeArabic(body) !== "" &&
    matchCommand(body) === null &&
    matchOrderCommand(body) === null
  );
}

export function decideBrowsing(input: BrowsingInput): BrowsingDecision {
  const { intent, catalog, contactPhone, offersDelivery } = input;
  const { deliveryFeeMinor, currency, payment, body } = input;
  /**
   * 🔴 «آخر إضافة» is emptied by **every** message (brief ن §4) — a command,
   *    «سلة», «شيل», «منيو», a message not understood: each branch starts
   *    from this `data`. The items branch writes the lines it added; a note
   *    alone that sticks keeps them (ن-3).
   */
  const data: SessionData = { ...input.data, last_added: [] };

  /** الملخّص ← `cart_review`. */
  const summaryDecision = (
    next: SessionData,
    fulfillment: SummaryFulfillment,
  ): BrowsingDecision =>
    withReply(
      next,
      renderSummary(next, fulfillment, currency, payment),
      "cart_review",
    );

  /**
   * «تم» بسلّة فيها أصناف — وبعد «نفسه» كمان (بريف ك، القرار 8): **نفس
   * الفرع، مش نسخة منه**. الصفوف الأربعة الأولى من ج §3، بنفس ترتيبها.
   */
  const checkout = (next: SessionData): BrowsingDecision => {
    // ١. طريقة الاستلام مختارة وكاملة — رجع من «عدّل» مثلا. ولا سؤال
    //    تاني عن إشي انسأل عنه، والملخّص رأسا.
    const chosen = toSummaryFulfillment(next.fulfillment);
    if (chosen !== null) return summaryDecision(next, chosen);

    // ٢. المطعم ما بيوصّل: الاستلام هو الخيار الوحيد، فما بينسأل عنه.
    //    مطعم «توصيل فقط» مش مدعوم بالبايلوت — انحراف مسجّل (ج §2.4).
    if (!offersDelivery) {
      return summaryDecision(
        { ...next, fulfillment: { type: "pickup" } },
        { type: "pickup" },
      );
    }

    // ٣. بيوصّل وما في اختيار بعد: السؤال، والرسوم بتنقال قبل ما يقرر.
    //    🔴 ولا snapshot هون — الرسوم بتنحفظ لحظة ما يختار «توصيل»
    //    فعلا، مش لحظة ما بنسأله. لو اختار «استلام» ما إلها معنى أصلا.
    return withReply(
      next,
      fulfillmentAskAr(deliveryFeeMinor, currency),
      "fulfillment_choice",
    );
  };

  /** `N` = عدد مفاتيح `menu_map` — لا عدد الأصناف بالقاعدة (§4). */
  const lastMenuNumber = Object.keys(data.menu_map).length;

  switch (intent.kind) {
    // -----------------------------------------------------------------------
    // الأوامر — كلها بتصفّر العدّاد: «أي نجاح — … أو أمر معروف» (§4)
    // -----------------------------------------------------------------------
    case "command": {
      const next = { ...data, unparsed_streak: 0 };
      switch (intent.command) {
        case "menu":
          return { next, reply: null, resendMenu: true, advanceTo: null };
        case "cart":
          return withReply(next, renderCart(next, currency));
        case "finish": {
          // 🔴 سلّة فارغة: **ولا انتقال ولا CAS**، رسالة وبس، والجلسة بتضل
          //    `browsing` — فالزبون بيقدر يبلّش طلبه من نفس المكان (ب-5).
          if (next.cart.length === 0) {
            return withReply(next, CART_EMPTY_ON_FINISH_AR);
          }
          return checkout(next);
        }
        default: {
          const unhandled: never = intent.command;
          return unhandled;
        }
      }
    }

    // -----------------------------------------------------------------------
    // «نفسه» — بريف ك. وصلت هون بشرطيها (`interpretBrowsing`).
    // -----------------------------------------------------------------------
    case "reorder": {
      // 🔴 التوفّر **حيّ، مرة تانية**: صنف ممكن ينطفى بين الترحيب و«نفسه».
      //    والسعر سعر اللحظة — «السعر وعد من لحظة الإضافة» (§14.5)، وهاي
      //    لحظة الإضافة. الاسم كمان من الكتالوج.
      const cart: CartLine[] = [];
      const missing: string[] = [];
      for (const item of intent.reorder.items) {
        const entry = catalog.get(item.item_id);
        if (entry === undefined || !entry.available) {
          // الاسم اللي شافه بالكتلة: صف انمسح كليا ما إله اسم بالكتالوج.
          missing.push(item.name);
          continue;
        }
        cart.push({
          item_id: item.item_id,
          name: entry.name,
          unit_price_minor: entry.unitPriceMinor,
          qty: item.qty,
          // The old line's note comes along (brief ن, decision 4).
          note: item.note,
        });
      }

      // السلّة كانت فاضية (الشرط)، فهاي سلّته كلها.
      const next: SessionData = { ...data, cart, unparsed_streak: 0 };
      const missingLine =
        missing.length === 0 ? null : itemsUnavailableLineAr(missing);

      // ولا صنف ضل: سطر الناقص، وتحته نص السلّة الفاضية، والحالة `browsing`.
      if (cart.length === 0) {
        return withReply(
          next,
          [...(missingLine === null ? [] : [missingLine]), CART_EMPTY_AR].join(
            "\n",
          ),
        );
      }

      // 🔴 نفس اللي بيصير بعد «تم» بسلّة مش فاضية (القرار 8) — ولا نص
      //    جديد ولا رسالة زيادة. الناقص بسطر **بأول نفس الرد**.
      const decision = checkout(next);
      return missingLine === null || decision.reply === null
        ? decision
        : { ...decision, reply: `${missingLine}\n${decision.reply}` };
    }

    // -----------------------------------------------------------------------
    // «شيل <رقم>» — §12 و§14.3
    // -----------------------------------------------------------------------
    case "remove": {
      const next = { ...data, unparsed_streak: 0 };
      const itemId = data.menu_map[String(intent.number)];
      if (itemId === undefined) {
        return withReply(
          next,
          unknownNumbersLineAr([intent.number], lastMenuNumber),
        );
      }
      if (!next.cart.some((l) => l.item_id === itemId)) {
        // 🔴 سطر لحاله، **بلا إعادة السلّة**: السلّة ما تغيّرت، وعرضها بيقول
        //    للزبون إن إشي صار.
        const entry = catalog.get(itemId);
        return withReply(
          next,
          entry === undefined
            ? unknownNumbersLineAr([intent.number], lastMenuNumber)
            : itemNotInCartAr(entry.name),
        );
      }
      // السطر كامل، لا وحدة من الكمية (§12.3-ج).
      const removed = {
        ...next,
        cart: next.cart.filter((l) => l.item_id !== itemId),
      };
      return withReply(removed, renderCart(removed, currency));
    }

    // -----------------------------------------------------------------------
    // أصناف
    // -----------------------------------------------------------------------
    case "items": {
      const result = intent.result;
      const streak = nextUnparsedStreak(data.unparsed_streak, result.outcome);

      if (result.outcome === "unparsed") {
        // A note in a message of its own (brief ن §5): no number at all —
        // a number off the menu is still a number, and today's reply.
        if (result.problems.unknownNumbers.length === 0) {
          const stuck = stickNote(data, input.data.last_added, body);
          if (stuck.kind === "stuck") {
            // A message understood: the streak is 0.
            return withReply(
              {
                ...data,
                cart: stuck.cart,
                last_added: stuck.lastAdded,
                unparsed_streak: 0,
              },
              stuck.reply,
            );
          }
          if (stuck.kind === "too-long") {
            // ن4ب, nothing changed — «آخر إضافة» kept, so a shorter one
            // sent next sticks («اكتبها أقصر»).
            return withReply(
              {
                ...data,
                last_added: input.data.last_added,
                unparsed_streak: 0,
              },
              NOTE_TOO_LONG_AR,
            );
          }
        }

        const next = { ...data, unparsed_streak: streak };
        // 🔴 بعد الاستسلام: صمت على غير المفهوم **وحده** (§14.7). رقم صحيح
        //    بعدها بيمرق من فرع الأصناف تحت ويتخدم عاديا.
        if (data.handoff_sent) return withReply(next, null);
        if (streak >= HANDOFF_STREAK) {
          // مرة وحدة بالجلسة. والرقم NULL = صمت تام، لا نص بديل (§11.3).
          const handedOff = { ...next, handoff_sent: true };
          return withReply(
            handedOff,
            contactPhone === null ? null : handoffMessageAr(contactPhone),
          );
        }
        // ن5 at the end, once (brief ن §3): the note did not stick.
        if (noteHintDue(data, data.cart, body)) {
          return withReply(
            { ...next, note_hint_sent: true },
            `${nothingUnderstoodAr(lastMenuNumber)}\n${NOTE_HINT_AR}`,
          );
        }
        return withReply(next, nothingUnderstoodAr(lastMenuNumber));
      }

      // parsed · partial — تعرّفنا على صنف حقيقي، فالعدّاد صفر (§13.3).
      const cart = [...data.cart];
      const added: { name: string; qty: number; note: string | null }[] = [];
      const lastAdded: LastAdded[] = [];
      const unknownNumbers = [...result.problems.unknownNumbers];
      const unavailable: string[] = [];
      const overCap = result.problems.overCapItems.map((o) => o.requestedQty);
      /** ن4أ — items whose note is over the limit: not added at all. */
      const tooLong: string[] = [];
      const once = <T>(list: T[], value: T): void => {
        if (!list.includes(value)) list.push(value);
      };

      // 1. Each line the parser read: its item, live, and its note without
      //    the item's own name (brief ن §2.3) — the length is checked on
      //    what is left. Two lines the name made one («2 شاورما 2») are one.
      const accepted: {
        itemId: string;
        name: string;
        unitPriceMinor: number;
        qty: number;
        note: string | null;
      }[] = [];
      for (const item of result.items) {
        const entry = catalog.get(item.itemId);
        if (entry === undefined) {
          // الصف انمسح كليا — ما في اسم نقول عنه «غير متوفر».
          once(unknownNumbers, item.number);
          continue;
        }
        if (!entry.available) {
          once(unavailable, entry.name);
          continue;
        }
        const note =
          item.note === null ? null : noteWithoutName(item.note, entry.name);
        if (note !== null && noteLength(note) > NOTE_MAX_LENGTH) {
          once(tooLong, entry.name);
          continue;
        }
        const same = accepted.find(
          (a) => a.itemId === item.itemId && noteKey(a.note) === noteKey(note),
        );
        if (same !== undefined) same.qty += item.qty;
        else {
          accepted.push({
            itemId: item.itemId,
            name: entry.name,
            unitPriceMinor: entry.unitPriceMinor,
            qty: item.qty,
            note,
          });
        }
      }

      // 2. 🔴 السقف على **السلّة**، لا على الرسالة وحدها (§14.7): «2 ×30» ثم
      //    «2 ×30» = 60 — **وعلى الصنف كله** (brief ن §4): every line of the
      //    item in the cart, and every line this message adds to it. Over it,
      //    the item is refused whole; the number said is the total refused.
      const refused = new Set<string>();
      for (const a of accepted) {
        if (refused.has(a.itemId)) continue;
        const inCart = cart
          .filter((l) => l.item_id === a.itemId)
          .reduce((sum, l) => sum + l.qty, 0);
        const inMessage = accepted
          .filter((b) => b.itemId === a.itemId)
          .reduce((sum, b) => sum + b.qty, 0);
        if (inCart + inMessage > MAX_QTY_PER_ITEM) {
          refused.add(a.itemId);
          overCap.push(inCart + inMessage);
        }
      }

      // 3. A line is (item, note normalized): the same key adds to it, and
      //    its first snapshot stays; a new key is a line at today's price.
      for (const a of accepted) {
        if (refused.has(a.itemId)) continue;
        const at = cart.findIndex(
          (l) => l.item_id === a.itemId && noteKey(l.note) === noteKey(a.note),
        );
        const existing = at === -1 ? undefined : cart[at];
        if (existing === undefined) {
          // السعر والاسم snapshot لحظة الإضافة — وعد للزبون (§14.5).
          cart.push({
            item_id: a.itemId,
            name: a.name,
            unit_price_minor: a.unitPriceMinor,
            qty: a.qty,
            note: a.note,
          });
          added.push({ name: a.name, qty: a.qty, note: a.note });
          lastAdded.push({ item_id: a.itemId, note: a.note, qty: a.qty });
        } else {
          // سطر موجود: الكمية بتزيد، والـsnapshot الأول بيضل — ونص ملاحظته.
          cart[at] = { ...existing, qty: existing.qty + a.qty };
          added.push({ name: existing.name, qty: a.qty, note: existing.note });
          lastAdded.push({
            item_id: a.itemId,
            note: existing.note,
            qty: a.qty,
          });
        }
      }

      // 🔴 الترتيب ثابت (§14.1-1): النجاح أولا، ثم المشاكل. سطر لكل نوع.
      const lines: string[] = [
        ...itemsAddedLinesAr(added, cartTotalMinor(cart), currency),
      ];
      if (unknownNumbers.length > 0) {
        lines.push(unknownNumbersLineAr(unknownNumbers, lastMenuNumber));
      }
      // سطر واحد لكل غير المتوفر — نص الجمع وصل، ففجوة §14.8#1 انسدّت.
      if (unavailable.length > 0) {
        lines.push(itemsUnavailableLineAr(unavailable));
      }
      if (overCap.length > 0) lines.push(overCapLineAr(overCap));
      for (const name of tooLong) lines.push(noteTooLongItemAr(name));
      if (result.problems.unclearParts.length > 0) {
        lines.push(unclearPartsLineAr(result.problems.unclearParts));
      }
      // ن5 after «غير واضح» — text before the first number (brief ن §3).
      let noteHintSent = data.note_hint_sent;
      if (
        result.problems.unclearParts.length > 0 &&
        noteHintDue(data, cart, body)
      ) {
        lines.push(NOTE_HINT_AR);
        noteHintSent = true;
      }

      // تذكير «تم» على تأكيد الصنف الأول وحده — مرة بالجلسة كلها (§2).
      let finishHintSent = data.finish_hint_sent;
      if (added.length > 0 && !finishHintSent) {
        lines.push(FINISH_HINT_AR);
        finishHintSent = true;
      }

      const next: SessionData = {
        ...data,
        cart,
        unparsed_streak: streak,
        finish_hint_sent: finishHintSent,
        note_hint_sent: noteHintSent,
        last_added: lastAdded,
      };
      return withReply(next, lines.length > 0 ? lines.join("\n") : null);
    }

    default: {
      const unhandled: never = intent;
      return unhandled;
    }
  }
}

// ---------------------------------------------------------------------------
// القشرة — I/O
// ---------------------------------------------------------------------------

/** المعرّفات اللي بيحتاجها القرار من الكتالوج — ولا غيرها. */
function itemIdsNeeded(intent: BrowsingIntent, data: SessionData): string[] {
  if (intent.kind === "items") return intent.result.items.map((i) => i.itemId);
  if (intent.kind === "reorder")
    return intent.reorder.items.map((i) => i.item_id);
  if (intent.kind === "remove") {
    const id = data.menu_map[String(intent.number)];
    return id === undefined ? [] : [id];
  }
  return [];
}

export interface BrowsingMessage {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  /** نص الرسالة. `null` لصورة أو صوت — بيتعامل كرسالة ما انفهم منها شي. */
  readonly body: string | null;
  readonly contactPhone: string | null;
  readonly offersDelivery: boolean;
  readonly deliveryFeeMinor: number;
  readonly currency: Currency;
  readonly payment: SummaryPayment;
  readonly now: Date;
}

/**
 * 🔴 **القفل أول شي بيلمس صف الجلسة.** `readSessionData` = `SELECT … FOR UPDATE`،
 *    وقبلها ولا `UPDATE` على الصف — ولا حتى `last_message_at`، اللي بينكتب
 *    **مع** `context` بنفس الكتابة. تحديث قبل القراءة كان بياخد القفل بالصدفة،
 *    فبيسلسل الرسائل المتزامنة بالترتيب بدل القفل — وقاعدة §14.1-3 صريحة:
 *    **القفل هو ما يمنعها، لا الترتيب.**
 *
 * 🔴 **ولا منع تكرار هون** (§14.1-4). رسالتان متطابقتان بمعرّفين مختلفين
 *    طلبان حقيقيان: زبون كتب «2» مرتين بدّه صنفين. الطبقة الأولى على
 *    `event_id` وكفى. بيبان كعطل وهو السلوك الصحيح — لا «تصلحه».
 *
 * الكتابة **قبل** الإرسال، زي `deliverMenu`: الإرسال أثر ما بينسحب، فلو فشلت
 * الكتابة بعده بيصير الزبون ماسك ردا عن سلّة ما انحفظت.
 */
export async function handleBrowsingMessage(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: BrowsingMessage,
): Promise<void> {
  const data = await readSessionData(tx, message.sessionId);
  const intent = interpretBrowsing(message.body ?? "", data);
  const catalog = await readCatalog(tx, itemIdsNeeded(intent, data));

  const decision = decideBrowsing({
    data,
    intent,
    catalog,
    contactPhone: message.contactPhone,
    offersDelivery: message.offersDelivery,
    deliveryFeeMinor: message.deliveryFeeMinor,
    currency: message.currency,
    payment: message.payment,
    body: message.body ?? "",
  });

  if (decision.resendMenu) {
    // «منيو» moves no state: `decideBrowsing` never pairs it with advanceTo.
    await resendMenu(tx, sender, message, decision.next);
    return;
  }

  if (decision.advanceTo !== null) {
    // 🔴 CAS ذري من `browsing`. `rowcount = 0` = حدا تاني سبقنا («تم» مرتين
    //    بنفس اللحظة) → **تجاهل بصمت، لا استثناء**، وبلا كتابة وبلا إرسال:
    //    ولا انتقال تاني، ولا عدّ رسالة صادرة ما انبعثت.
    if (
      !(await advanceSessionState(
        tx,
        message.sessionId,
        "browsing",
        decision.advanceTo,
      ))
    ) {
      logger.debug(
        {
          restaurantId: message.restaurantId,
          sessionId: message.sessionId,
          target: decision.advanceTo,
        },
        "CAS خسر — «تم» انعالجت مرة قبل هيك. تجاهل صامت",
      );
      return;
    }
  }

  await writeSessionData(tx, message.sessionId, decision.next, message.now);

  if (decision.reply !== null) {
    await sender.sendText({
      restaurantId: message.restaurantId,
      phoneNumberId: message.phoneNumberId,
      to: message.to,
      body: decision.reply,
    });
  }

  if (intent.kind === "reorder") {
    logger.info(
      {
        restaurantId: message.restaurantId,
        from: maskPhone(message.to),
        items: decision.next.cart.length,
        sourceOrderId: intent.reorder.order_id,
      },
      "«نفسه» — السلّة تعبّت من آخر طلب",
    );
  }
}

/**
 * «منيو»: نفس الطريق الوحيد لإرسال قائمة — الخريطة بتنستبدل كاملة معها.
 *
 * 🔴 Prepared BEFORE the session is written (brief ي-أ §4, step 3): a menu
 *    with no item to show is not sent — the paused text goes instead, and
 *    then the session must stay exactly as it was, its streak and
 *    `last_message_at` included. Otherwise the order is the one it always
 *    was: the write, then the menu (or the error line, when it is too long).
 */
async function resendMenu(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: BrowsingMessage,
  next: SessionData,
): Promise<void> {
  const prepared = await prepareMenu(tx, null, message.currency);

  if (!prepared.ok && prepared.reason === "empty") {
    await replyOrdersPaused(sender, message, "empty_menu");
    return;
  }

  await writeSessionData(tx, message.sessionId, next, message.now);

  if (!prepared.ok) {
    logger.error(
      {
        restaurantId: message.restaurantId,
        chars: prepared.error.length,
        limit: prepared.error.limit,
      },
      "🔴 «منيو»: القائمة أطول من سقف واتساب — ما انبعثت وما انقطعت",
    );
    return;
  }
  await deliverMenu(tx, sender, {
    sessionId: message.sessionId,
    restaurantId: message.restaurantId,
    phoneNumberId: message.phoneNumberId,
    to: message.to,
    menu: prepared.menu,
    now: message.now,
  });
}
