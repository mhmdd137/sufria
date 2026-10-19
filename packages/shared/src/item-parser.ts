import {
  FINISH_INPUTS,
  matchCommand,
  normalizeArabic,
  normalizeWithOrigins,
  type CustomerCommand,
  type NormalizedChar,
} from "./normalize.js";

/**
 * محلّل الأصناف، وموزّع الرسالة الواردة أثناء التصفّح.
 *
 * 🔴 **قاعدة العلامة الصريحة هي الفرق بين محلّل صحيح ومحلّل يخمّن.**
 *    رقم مجرّد = **رقم صنف دائما**. الكمية تلزمها `×` أو `x` أو `*`.
 *    بدونها «2 و5» بتصير «صنف 2 كمية 5» — وهي الغلطة اللي وُجد سطر الإضافة
 *    ليمسكها. ممنوع يخمّن المحلّل ثم نتّكل على السطر ليصحّح.
 *
 * 🔴 **`menu_map` هي الحقيقة، لا جدول `menu_items`.** المحلّل ما بيلمس القاعدة
 *    إطلاقا: بياخد الخريطة المخزّنة لحظة إرسال القائمة، و`N` = عدد مفاتيحها.
 *    عدّ صفوف من القاعدة بيعطي رقما مختلفا عن اللي شافه الزبون أول ما يخفي
 *    المطعم صنفا — وهاد الخطأ الصامت #2 عائدا من باب المحلّل.
 */

/**
 * سقف الكمية **للصنف الواحد بعد التجميع** — حماية من `2 ×9999`.
 *
 * 🔴 السقف على مجموع الصنف، لا على الرمز المكتوب. سقف على الرمز بينلتف عليه
 *    بـ«2 ×15 و2 ×10» — يعني مش قاعدة، هو فلتر مكتوب فوقه نص بيدّعي قاعدة.
 *    والتجميع هو اللي بيخلّي النص صادق: «الأقصى 50 للصنف الواحد» بيعني 50
 *    للصنف الواحد، مهما تقسّمت الكمية.
 *
 * 🔴 و50 لا 20: 50 فوق أي طلب واقعي لصنف واحد، فالقاعدة حقيقية وما بتعضّ
 *    حدا. حجم الطلب نفسه **بلا سقف** — «1 ×50 و2 ×50» بيمرق.
 *
 * السقف انتقل مرتين قبل ما يستقر هون، والسبب مسجّل ببريف السلّة §13.1.
 *
 * ⚠️ نصه بيكتب الرقم حرفيا — اختبار بيربطه بهالثابت.
 */
export const MAX_QTY_PER_ITEM = 50;

/** علامات الكمية الصريحة. `X` الكبيرة نفس `x` — حرف واحد بحالتين، لا علامة جديدة. */
const QTY_MARKERS = "×x*";

export interface ParsedItem {
  /** رقم الصنف كما ظهر بالقائمة. */
  readonly number: number;
  readonly itemId: string;
  readonly qty: number;
  /**
   * The customer's note for this line (brief ن §2): the raw text after the
   * item's number — and its quantity — up to the next number, cleaned
   * (`cleanNote`), or `null`. The item's name is not taken off here: the
   * engine does it (`noteWithoutName`), where the name is known.
   */
  readonly note: string | null;
}

export interface ParseProblems {
  /** أرقام مش موجودة بـ`menu_map` — بتتسمّى بالرد وما بتسقّط الصحيح. */
  readonly unknownNumbers: readonly number[];
  /** أجزاء نصية ما انفهمت. بتترجع للزبون نصا — لا ملاحظة ولا حذف صامت. */
  readonly unclearParts: readonly string[];
  /**
   * أصناف مجموع كميتها بعد التجميع تجاوز السقف. الصنف **متعرَّف عليه** —
   * بس الكمية مرفوضة، والصنف كله بينرفض لا جزء منه.
   * `requestedQty` = المجموع. نصها `qtyOverCapMessageAr` بـ`domain.ts`.
   */
  readonly overCapItems: readonly {
    readonly number: number;
    readonly requestedQty: number;
  }[];
}

/**
 * ثلاث حالات لا اثنتان — والفاصل هو: **هل تعرّفنا على أي رقم صنف؟**
 *
 * 🔴 العدّاد (قيد 2ج) بيرتفع **بس** لما ما نتعرّف على رقم صنف ولا على أمر.
 *    - «2 بدون بصل» — صنف انضاف. رسالة نجح نصها مش رسالة غير مفهومة.
 *    - «2 ×9999» — ولا صنف انضاف، **بس الصنف 2 متعرَّف عليه** والكمية
 *      انرفضت بسبب مسمّى. الزبون فهمناه، وما بيتقدّم نحو رسالة الاستسلام.
 *    - «15» على قائمة من 5 — رقم **مش** صنف. ما تعرّفنا على شي.
 */
export type ParseOutcome =
  /** صنف واحد على الأقل انضاف، وولا مشكلة. */
  | "parsed"
  /**
   * تعرّفنا على رقم صنف واحد على الأقل، ومعه مشكلة: رقم غلط، نص غير واضح،
   * أو كمية فوق السقف. ⚠️ ممكن `items` تكون فاضية هون — «2 ×9999» لحالها.
   */
  | "partial"
  /** ولا رقم صنف متعرَّف عليه. العدّاد بيرتفع على هاي وبس. */
  | "unparsed";

export interface ParseResult {
  readonly outcome: ParseOutcome;
  readonly items: readonly ParsedItem[];
  readonly problems: ParseProblems;
  /** `N` برسائل الخطأ = عدد مفاتيح `menu_map`. */
  readonly menuSize: number;
}

export type MenuMap = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// التقطيع
// ---------------------------------------------------------------------------

/** A token of the message: its normalized text, and where it sits in the raw one. */
interface Token {
  readonly text: string;
  /** `raw.slice(start, end)` is the customer's own text of this token. */
  readonly start: number;
  readonly end: number;
}

/**
 * `normalizeArabic` بتقصّ الرموز من طرف الرسالة — و`×` و`*` رموز. فعلامة
 * بأول الرسالة («×3 و2») كانت بتختفي وبتصير «3» = **صنف 3**. زبون ما طلب
 * الصنف 3 كان بيلاقيه بسلّته.
 *
 * الإصلاح هون لا بالتطبيع: `normalizeArabic` بتخدم مطابقة الأوامر كمان، وقصّ
 * الطرفين هو اللي بيخلّي «تم 👍» = «تم». بنرجّع العلامة المقصوصة بس.
 * (`x` حرف، فالتطبيع ما بيقصّها أصلا.)
 */
function restoreLeadingMarker(
  raw: string,
  units: readonly NormalizedChar[],
): readonly NormalizedChar[] {
  const lead = /^[^\p{L}\p{N}]*/u.exec(raw)?.[0] ?? "";
  const at = Math.max(lead.lastIndexOf("×"), lead.lastIndexOf("*"));
  if (at === -1) return units;
  const marker: NormalizedChar = { c: lead[at]!, start: at, end: at + 1 };
  // ملزوقة بالرقم («×3») بتضل ملزوقة؛ غير هيك بتصير رمزا لحالها («× 3»).
  return at === lead.length - 1
    ? [marker, ...units]
    : [marker, { c: " ", start: at + 1, end: at + 1 }, ...units];
}

/**
 * الفواصل: مسافة · `و` · `,` · `،` · `+` · سطر جديد.
 *
 * 🔴 `و` فاصل **بس لما تكون منفصلة أو ملزوقة برقم**. شطبها من أول كل كلمة
 *    بيحوّل «واحد» لـ«احد» — والنص غير المفهوم بيرجع للزبون حرفيا، فتشويهه
 *    بيخلّيه يقرأ كلمة ما كتبها.
 *
 * Every replacement below is one character for one, so each character of the
 * text keeps its raw span; a token's span runs from its first character's to
 * its last's. A separator is never inside a token, so a note — the raw text
 * from its first token to its last — has none at its two ends, and keeps
 * those between its words (brief ن §2.1).
 */
function tokenize(raw: string): Token[] {
  const units = restoreLeadingMarker(raw, normalizeWithOrigins(raw));
  const starts: number[] = [];
  const ends: number[] = [];
  for (const u of units) {
    for (let k = 0; k < u.c.length; k++) {
      starts.push(u.start);
      ends.push(u.end);
    }
  }
  const text = units
    .map((u) => u.c)
    .join("")
    .replace(/[,،+]/gu, " ")
    .replace(/(?<=[0-9])و(?=[0-9])/gu, " ") // 2و3
    .replace(/(^|\s)و(?=[0-9])/gu, "$1 ") // 2 و3
    .replace(/(^|\s)و(?=\s|$)/gu, "$1 "); // 2 و 3
  return [...text.matchAll(/\S+/gu)].map((m) => ({
    text: m[0],
    start: starts[m.index]!,
    end: ends[m.index + m[0].length - 1]!,
  }));
}

// ---------------------------------------------------------------------------
// الملاحظة — بريف ن §2
// ---------------------------------------------------------------------------

/** Characters a note never keeps: direction marks, zero-width, BOM (§2.5). */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;
/** Control characters other than white space, which turns into a space. */
const CONTROL = /(?!\s)\p{Cc}/gu;

/**
 * A note as it is kept and shown (brief ن §2.5): the invisible and control
 * characters gone, every run of white space one space, both ends trimmed —
 * and nothing left is no note. The words stay exactly as written.
 */
export function cleanNote(raw: string): string | null {
  const note = raw
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
  return note === "" ? null : note;
}

/**
 * What two notes are compared by (§2.1): «زيادة» and «زياده» are one note.
 * Only compared — the note kept and shown is the first raw text that came.
 */
export function noteKey(note: string | null): string | null {
  return note === null ? null : normalizeArabic(note);
}

/** A note's length as the database counts it (`char_length`): code points. */
export function noteLength(note: string): number {
  return [...note].length;
}

/** A second note for the same pieces joins the first (brief ن, Claude's call). */
export function joinNotes(first: string, second: string): string {
  return `${first}، ${second}`;
}

/** Never taken off a note's start, whatever the item's name (§2.3). */
const NEGATION_WORDS: ReadonlySet<string> = new Set([
  "بدون",
  "بلا",
  "بلاش",
  "غير",
  "من",
]);

/**
 * The note without the item's own name (brief ن §2.3, decision 5 with its
 * safety fix): «1 شاورما دجاج بدون بصل» on «شاورما دجاج» is «بدون بصل».
 *
 * 🔴 From the note's **start**, and **in the name's order**: a word goes
 *    while it equals the name's next word (normalized). The first that does
 *    not stops it — «1 دجاج» keeps «دجاج», it is not the name's start.
 * 🔴 **A word of negation never goes**, even inside the name: on «قهوة بدون
 *    سكر», «3 قهوة بدون هيل» keeps «بدون هيل». Taking words off one by one
 *    would leave «هيل» — the opposite of what the customer asked.
 *
 * `null` when nothing is left.
 */
export function noteWithoutName(note: string, itemName: string): string | null {
  const nameWords = itemName
    .split(/\s+/u)
    .map(normalizeArabic)
    .filter((w) => w !== "");
  const words = note.split(/\s+/u);
  let taken = 0;
  while (taken < words.length && taken < nameWords.length) {
    const word = normalizeArabic(words[taken]!);
    if (NEGATION_WORDS.has(word) || word !== nameWords[taken]) break;
    taken++;
  }
  if (taken === 0) return cleanNote(note);
  // What the name leaves may start with a separator: «شاورما و بدون بصل».
  let rest = words.slice(taken);
  while (rest.length > 0 && ["", "و"].includes(normalizeArabic(rest[0]!))) {
    rest = rest.slice(1);
  }
  return cleanNote(rest.join(" "));
}

/** «2 بدون بصل تم» — the finish word ends the note, and is not part of it. */
const FINISH_WORDS: ReadonlySet<string> = new Set(FINISH_INPUTS);
const LONGEST_FINISH = Math.max(
  ...FINISH_INPUTS.map((w) => w.split(" ").length),
);

/**
 * A line's note from its tokens (§2.1): the finish words at its end taken
 * off, then the raw text of each run of consecutive tokens — a quantity
 * between two runs («2 بدون بصل ×2 زيادة») is the line's, not the note's —
 * joined by a space, and cleaned.
 */
function noteOf(
  raw: string,
  tokens: readonly Token[],
  indices: readonly number[],
): string | null {
  let kept = [...indices];
  for (let found = true; found && kept.length > 0;) {
    found = false;
    for (let n = Math.min(LONGEST_FINISH, kept.length); n > 0; n--) {
      const tail = kept
        .slice(-n)
        .map((i) => tokens[i]!.text)
        .join(" ");
      if (FINISH_WORDS.has(tail)) {
        kept = kept.slice(0, -n);
        found = true;
        break;
      }
    }
  }
  if (kept.length === 0) return null;

  const runs: number[][] = [];
  for (const i of kept) {
    const run = runs.at(-1);
    if (run !== undefined && run.at(-1) === i - 1) run.push(i);
    else runs.push([i]);
  }
  return cleanNote(
    runs
      .map((run) => {
        const first = tokens[run[0]!]!;
        const last = tokens[run.at(-1)!]!;
        return raw.slice(first.start, last.end);
      })
      .join(" "),
  );
}

const BARE_NUMBER = /^[0-9]+$/u;
const NUMBER_WITH_QTY = new RegExp(`^([0-9]+)[${QTY_MARKERS}]([0-9]+)$`, "iu");
const QTY_ONLY = new RegExp(`^[${QTY_MARKERS}]([0-9]+)$`, "iu");
const MARKER_ONLY = new RegExp(`^[${QTY_MARKERS}]$`, "iu");

// ---------------------------------------------------------------------------
// المحلّل
// ---------------------------------------------------------------------------

/**
 * بيحلّل رسالة أصناف مقابل `menu_map`.
 *
 * القواعد المنفَّذة، وكل وحدة إلها اختبار باسمها:
 *   - `2 5`   → صنفان. **لا «صنف 2 كمية 5»**
 *   - `2 ×3`  → صنف 2 كمية 3
 *   - `2 و2`  → صنف 2 ×2 (الرقم المكرر بتتجمّع كميته)
 *   - `×3 و2` → الصنف 2 وبس. **علامة الكمية لازم يسبقها رقم صنف**
 *   - الصنف اللي مجموعه فوق السقف بينرفض كله؛ حجم الطلب ما إله سقف
 *   - رقم برّا الخريطة بيتسمّى وما بيسقّط الصحيح
 *   - نص قبل أول رقم بيرجع للزبون؛ وبعد الرقم هو ملاحظته (بريف ن §2)
 *   - `2 بدون بصل 2` → سطران: المفتاح (الرقم، الملاحظة المطبَّعة)
 */
export function parseItems(raw: string, menuMap: MenuMap): ParseResult {
  const menuSize = Object.keys(menuMap).length;
  const tokens = tokenize(raw);

  /**
   * Every item number the message wrote opens a line (brief ن §2.1): its
   * quantity, and the tokens of its note — what follows it up to the next
   * number. A number off the menu opens one too, `known: false`: its note
   * goes with it, neither to another item nor back as «غير واضح».
   */
  interface Line {
    readonly number: number;
    readonly known: boolean;
    qty: number;
    readonly noteTokens: number[];
  }
  const lines: Line[] = [];
  /** The line a note token joins. `null` before the first number. */
  let current = null as Line | null;
  const unknownNumbers: number[] = [];
  const unclearParts: string[] = [];
  const overCapItems: { number: number; requestedQty: number }[] = [];

  /** أجزاء غير مفهومة متتالية بتتجمّع بجملة وحدة — «بدون بصل»، لا جزأين. */
  let unclearRun: string[] = [];
  const flushUnclear = (): void => {
    if (unclearRun.length > 0) {
      unclearParts.push(unclearRun.join(" "));
      unclearRun = [];
    }
  };

  /** آخر رقم صنف مقبول — العلامة المنفصلة (`2 ×3` / `2 × 3`) بتلزق فيه. */
  let lastNumber: number | null = null;
  /**
   * كم أضاف آخر رمز مقبول لـ`lastNumber`.
   *
   * 🔴 العلامة المنفصلة **بتستبدل** مساهمة الرمز اللي قبلها، ما بتزيد عليها.
   *    `2 × 3` = `2` أضافت 1، وبعدين `3` لازم تخلّي المجموع 3 — يعني `3 - 1`.
   *    الزيادة المباشرة بتعطي 4.
   */
  let lastContribution = 0;
  /**
   * الرقم السابق انرفض (برّا الخريطة) وانسمّى أصلا:
   * كمية منفصلة بعده بتنبلع بدل ما تنرجع «غير واضحة» فوق التسمية.
   */
  let swallowNextQty = false;
  /** علامة منفصلة تنتظر كميتها (`2 × 3`). */
  let pendingMarker = false;
  /** علامة **بلا رقم قبلها** («× 3»): الرقم اللي بعدها كمية لولا شي، مش صنف. */
  let orphanMarker = false;

  const forgetLast = (swallow: boolean): void => {
    lastNumber = null;
    lastContribution = 0;
    swallowNextQty = swallow;
  };

  /** كمية وصلت بعلامة منفصلة: بتستبدل مساهمة الرمز السابق. */
  const applySeparatedQty = (qty: number): void => {
    if (lastNumber === null || current === null) {
      forgetLast(false); // كانت مبلوعة — الرقم انسمّى
      return;
    }
    current.qty += qty - lastContribution;
    lastContribution = qty;
  };

  const acceptNumber = (number: number, qty: number): void => {
    flushUnclear();
    const known = menuMap[String(number)] !== undefined;
    current = { number, known, qty, noteTokens: [] };
    lines.push(current);
    if (!known) {
      unknownNumbers.push(number);
      forgetLast(true);
      return;
    }
    lastNumber = number;
    lastContribution = qty;
    swallowNextQty = false;
  };

  const hasAnchor = (): boolean => lastNumber !== null || swallowNextQty;

  for (const [index, { text: token }] of tokens.entries()) {
    // 🔴 كمية بعد علامة منفصلة: الرقم **مش مجرّد**، قبله علامة صريحة كتبها
    //    الزبون. قاعدة «رقم مجرّد = صنف» بتنطبق على المجرّد وبس.
    if (pendingMarker && BARE_NUMBER.test(token)) {
      pendingMarker = false;
      applySeparatedQty(Number(token));
      continue;
    }
    pendingMarker = false;

    // 🔴 «× 3» بلا صنف قبلها: الـ3 كمية لولا شي، **مش الصنف 3**. بتنضم للجزء
    //    غير المفهوم وبترجع للزبون مع علامتها.
    if (orphanMarker && BARE_NUMBER.test(token)) {
      orphanMarker = false;
      unclearRun.push(token);
      continue;
    }
    orphanMarker = false;

    if (MARKER_ONLY.test(token)) {
      if (hasAnchor()) {
        pendingMarker = true;
        continue;
      }
      unclearRun.push(token);
      orphanMarker = true;
      continue;
    }

    const withQty = NUMBER_WITH_QTY.exec(token);
    if (withQty !== null) {
      acceptNumber(Number(withQty[1]), Number(withQty[2]));
      continue;
    }

    const qtyOnly = QTY_ONLY.exec(token);
    if (qtyOnly !== null) {
      // `×3` لحالها بتلزق بالصنف اللي قبلها. بلا صنف قبلها: غير مفهومة.
      if (hasAnchor()) {
        flushUnclear();
        applySeparatedQty(Number(qtyOnly[1]));
        continue;
      }
      unclearRun.push(token);
      continue;
    }

    if (BARE_NUMBER.test(token)) {
      acceptNumber(Number(token), 1);
      continue;
    }

    // 🔴 Text after a number is that line's note (brief ن, decision 2), and
    //    the number stays the anchor: «2 بدون بصل ×2» is item 2 ×2. Text
    //    before the first number has no line to join, and is «غير واضح» as
    //    it always was.
    if (current !== null) {
      current.noteTokens.push(index);
      continue;
    }
    unclearRun.push(token);
    forgetLast(false);
  }
  flushUnclear();

  // 🔴 Lines merge by (number, normalized note), not by number (decision 8):
  //    «2 بدون بصل 2» is two lines. The note kept is the first raw text met.
  // 🔴 السقف **بعد** التجميع، **على الصنف كله**: «2 ×30 و2 ×30» = 60 للصنف 2،
  //    فبينرفض كله — ومهما تقسّم على ملاحظات. فحص كل رمز لحاله بيمرّقها،
  //    وهاد بالضبط الالتفاف اللي خلّى السقف ينرجع للتجميع. §13.1
  const merged = new Map<
    string,
    { number: number; qty: number; note: string | null }
  >();
  const totalOf = new Map<number, number>();
  for (const line of lines) {
    if (!line.known) continue;
    const note = noteOf(raw, tokens, line.noteTokens);
    const key = `${line.number}|${note === null ? "" : `+${noteKey(note)}`}`;
    const kept = merged.get(key);
    if (kept === undefined) {
      merged.set(key, { number: line.number, qty: line.qty, note });
    } else {
      kept.qty += line.qty;
    }
    totalOf.set(line.number, (totalOf.get(line.number) ?? 0) + line.qty);
  }

  for (const [number, qty] of totalOf) {
    if (qty > MAX_QTY_PER_ITEM)
      overCapItems.push({ number, requestedQty: qty });
  }

  const items: ParsedItem[] = [];
  for (const { number, qty, note } of merged.values()) {
    const itemId = menuMap[String(number)];
    if (itemId === undefined || qty <= 0) continue;
    if ((totalOf.get(number) ?? 0) > MAX_QTY_PER_ITEM) continue;
    items.push({ number, itemId, qty, note });
  }

  const problems: ParseProblems = {
    unknownNumbers,
    unclearParts,
    overCapItems,
  };
  const hasProblem =
    unknownNumbers.length > 0 ||
    unclearParts.length > 0 ||
    overCapItems.length > 0;

  // المتجاوز للسقف **متعرَّف عليه** — بيعدّ هون مع الأصناف المضافة.
  const recognized = items.length > 0 || overCapItems.length > 0;

  const outcome: ParseOutcome = !recognized
    ? "unparsed"
    : hasProblem
      ? "partial"
      : "parsed";

  return { outcome, items, problems, menuSize };
}

// ---------------------------------------------------------------------------
// عدّاد «ما تعرّفنا على شي» — قيد 2ج · §13.3
// ---------------------------------------------------------------------------

/** عند هالرقم بتنبعت رسالة الاستسلام — مرة واحدة (§4). */
export const HANDOFF_STREAK = 3;

/**
 * قيمة `unparsed_streak` بعد رسالة مرّت بالمحلّل.
 *
 * 🔴 **ثلاث نتائج وقاعدتان، بلا حالة مشتقّة:**
 *    - `unparsed` ← يرتفع
 *    - `parsed` · `partial` ← يصفّر
 *
 *    العدّاد بيقيس **سلسلة** لا مجموعا: كم رسالة **متتالية** ما تعرّفنا فيها
 *    على ولا صنف حقيقي. التعرّف على صنف حقيقي بيكسر السلسلة بالتعريف — حتى
 *    لو ما انضاف شي (`2 ×9999`). حالة ثالثة «لا يرفع ولا يصفّر» بتخلّي رسائل
 *    غير مفهومة يفصلها تعرّف حقيقي تتجمّع لسلسلة ما صارت، فبيوصل الزبون
 *    لرسالة الاستسلام وهو مفهوم.
 *
 * الـ`switch` شامل بالقصد: نتيجة رابعة بتنضاف لـ`ParseOutcome` بتوقّع
 * الـtypecheck هون، بدل ما تنزل بصمت على فرع التصفير.
 *
 * الأوامر ما بتمرق من المحلّل؛ تصفيرها بنص §4 («أي نجاح — … أو أمر معروف»)
 * وب-4 بتطبّقه.
 *
 * ⚠️ فجوة معروفة ومتروكة بالقصد — زبون بيكرّر «2 ×9999»: §13.3.
 */
export function nextUnparsedStreak(
  current: number,
  outcome: ParseOutcome,
): number {
  switch (outcome) {
    case "unparsed":
      return current + 1;
    case "parsed":
    case "partial":
      return 0;
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

// ---------------------------------------------------------------------------
// الموزّع — الترتيب إلزامي
// ---------------------------------------------------------------------------

/**
 * 🔴 `^شيل <رقم>$` **مرساة على الطرفين**، لا احتواء.
 *    بلا الإرساء «بدي شيل 2 صحون من هاد» بتحذف صنفا — وهي نفس ثغرة
 *    `includes` اللي إلها اختباران سالبان بـب-1، عائدة من باب تاني. §12.4
 */
const REMOVE_COMMAND = /^شيل\s+([0-9]+)$/u;

export type MessageIntent =
  | { readonly kind: "command"; readonly command: CustomerCommand }
  | { readonly kind: "remove"; readonly number: number }
  | { readonly kind: "items"; readonly result: ParseResult };

/**
 * بتوزّع الرسالة الواردة أثناء التصفّح. **الترتيب جزء من الصحة:**
 *
 *   1. الأوامر الأربعة — مطابقة الرسالة كاملة
 *   2. `شيل <رقم>` — مرساة
 *   3. محلّل الأصناف
 *
 * 🔴 لو مرق المحلّل قبلهم، «شيل 2» بتضيف الصنف 2 وبتقول «شيل غير واضح» —
 *    **الزبون طلب حذفا فصار إضافة**، وسلّة غلط بتوصل المطبخ بلا ولا رسالة خطأ.
 *    الترتيب محقّق هون بنيويا: الدالة وحدة، والرجوع متسلسل.
 */
export function interpretMessage(raw: string, menuMap: MenuMap): MessageIntent {
  const command = matchCommand(raw);
  if (command !== null) return { kind: "command", command };

  const remove = REMOVE_COMMAND.exec(normalizeArabic(raw));
  if (remove !== null) return { kind: "remove", number: Number(remove[1]) };

  return { kind: "items", result: parseItems(raw, menuMap) };
}
