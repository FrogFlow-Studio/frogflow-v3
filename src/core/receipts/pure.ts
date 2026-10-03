import { sniffProofMime } from "@/core/orders/proof-file";
/**
 * Проверка чека по распознанному тексту — чистые правила, без Vision и базы.
 * Допуск ±30% (v1) — для чека в чужой валюте: курс и спред банка дают сумму
 * рядом с заказом. В валюте заказа недоплата не проходит совсем
 * (SAME_CURRENCY_UNDERPAY), переплата — до +30%: скрин карточки товара на
 * +150% не проходит.
 */
export const UNDERPAY_TOLERANCE = 0.3;
export const OVERPAY_TOLERANCE = 0.3;
/**
 * Чек в валюте заказа: недоплата не проходит совсем (решение владельца
 * 27.09) — любая меньшая сумма уходит продавцу на ручную проверку.
 * Допуск ±30% остаётся для чеков в чужой валюте (сверка по курсу).
 */
export const SAME_CURRENCY_UNDERPAY = 0;

const RECEIPT_MARKERS = [
  "оплат",
  "перевод",
  "kaspi",
  "сбер",
  "тиньк",
  "tinkoff",
  "halyk",
  "карт",
  "тенге",
  "сумма",
  "kzt",
  "rub",
  "byn",
  "usd",
  "чек",
  "платеж",
  "платёж",
  "успешн",
  "зачисл",
  "получ",
  "отправил",
  "payment",
  "transfer",
  "receipt",
  "paid",
  "visa",
  "mastercard",
  "мир",
];

const CURRENCY_MARKERS: Record<string, string[]> = {
  KZT: ["kzt", "тенге", "тг.", "₸"],
  RUB: ["rub", "руб", "₽"],
  USD: ["usd", "$", "долл"],
  BYN: ["byn", "бел. руб", "бел.руб", "белруб"],
  KGS: ["kgs", "сом", "som"],
};

const PAYMENT_FAILED_PHRASES = [
  "платеж не прошел",
  "оплата не прошла",
  "перевод не выполнен",
  "перевод не прошел",
  "перевод отклонен",
  "операция отклонена",
  "операция отменена",
  "операция не выполнена",
  "платеж отклонен",
  "платеж отменен",
  "оплата отклонена",
  "оплата отменена",
  "недостаточно средств",
  "неверно введен",
  "данные введены неверно",
  "ошибка оплаты",
  "ошибка платежа",
  "ошибка перевода",
  "статус: ошибка",
  "статус ошибка",
  "платеж не осуществлен",
  "оплата не выполнена",
  "транзакция отклонена",
  "транзакция не прошла",
  "payment failed",
  "payment declined",
  "transaction failed",
  "transaction declined",
  "insufficient funds",
];

/** Скрин нашего же сообщения «сумма к оплате / пришлите чек» или карточки товара — не чек. */
const SHOP_SCREEN_PHRASES = [
  "сумма к оплате",
  "к оплате:",
  "amount due",
  "төлеуге тиіс сома",
  "төлемге:",
  "to‘lash summasi",
  "to'lash summasi",
  "tolash summasi",
  "пришлите скриншот",
  "пришлите чек",
  "в этот чат",
  "send the receipt",
  "send a screenshot",
  "in this chat",
  "чекті осы чатқа жіберіңіз",
  "скриншотты осы чатқа жіберіңіз",
  "chekni shu chatga yuboring",
  "skrinshotni shu chatga yuboring",
  "выберите способ оплаты",
  "оплатить через robokassa",
  "оплатить по реквизитам",
  "продолжить оплату",
  "в корзине",
  "добавить в корзину",
];
const RECEIPT_DONE_PHRASES = [
  "оплата совершена",
  "платеж выполнен",
  "успешно проведен",
  "успешно проведена",
  "перевод выполнен",
  "перевод успешно",
  "зачисл",
  "фискальн",
  "сумма операции",
  "сумма выплаты",
  "сумма в местной валюте",
  "чек по операции",
  "рнм",
  "комиссия за",
  "payment successful",
  "paid successfully",
  "operation completed",
  "операция выполнена",
];
const ORDER_CREATED_RE =
  /(?:заказ|тапсырыс|buyurtma|order)\s*#\s*\d+[\s\S]{0,120}(?:создан|жасалды|yaratildi|created)/;

const norm = (t: string) => t.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

export function looksLikeFailedPayment(text: string): boolean {
  const t = norm(text);
  return PAYMENT_FAILED_PHRASES.some((p) => t.includes(p));
}

/** В тексте есть прямые слова банка о проведённом платеже, а не только «оплата». */
export function looksLikeCompletedPayment(text: string): boolean {
  const t = norm(text);
  return RECEIPT_DONE_PHRASES.some((p) => t.includes(p));
}

export function looksLikeShopScreenNotReceipt(text: string): boolean {
  const t = norm(text);
  if (RECEIPT_DONE_PHRASES.some((p) => t.includes(p))) return false;
  if (SHOP_SCREEN_PHRASES.some((p) => t.includes(p))) return true;
  return ORDER_CREATED_RE.test(t);
}

const AMOUNT_TOKEN = String.raw`\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+`;
const AMOUNT_DEC = String.raw`(?:[.,]\d{1,2})?`;
const CURRENCY_AMOUNT_TAIL: Record<string, string> = {
  KZT: String.raw`(?:kzt|₸|тенге|тг\.?)`,
  RUB: String.raw`(?:₽|руб(?:\.|лей|ля)?|rub)`,
  USD: String.raw`(?:usd|\$|долл)`,
  BYN: String.raw`(?:byn|бел\.?\s*руб)`,
  KGS: String.raw`(?:kgs|сом|som)`,
};
const CURRENCY_TAIL = `(?:${Object.values(CURRENCY_AMOUNT_TAIL).join("|")})`;

function parseAmountToken(raw: string): number | null {
  const n = Number(raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

function insideLongDigitRun(text: string, index: number, length: number): boolean {
  let start = index;
  while (start > 0 && /\d/.test(text[start - 1]!)) start--;
  let end = index + length;
  while (end < text.length && /\d/.test(text[end]!)) end++;
  return end - start >= 8;
}

/** Суммы из текста: «227 ₽», «1 900 ₸», «Сумма операции 228». Телефоны и даты — не деньги. */
export function extractMoneyAmounts(text: string): number[] {
  const out = new Set<number>();
  const amount = `(?:${AMOUNT_TOKEN})${AMOUNT_DEC}`;
  const add = (raw: string) => {
    const n = parseAmountToken(raw);
    if (n != null) out.add(n);
  };
  for (const m of text.matchAll(new RegExp(`(${amount})\\s*${CURRENCY_TAIL}`, "gi")))
    add(m[1] ?? "");
  for (const m of text.matchAll(
    new RegExp(
      `(?:сумма(?:\\s+(?:операции|выплаты|перевода|платежа|в\\s+местной\\s+валюте))?|итого)\\s*[:\\-]?\\s*(${amount})`,
      "gi",
    ),
  ))
    add(m[1] ?? "");
  const dates = new Set<string>();
  for (const m of text.matchAll(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/g)) if (m[0]) dates.add(m[0]);
  for (const m of text.matchAll(new RegExp(`${amount}|\\d{2,7}`, "g"))) {
    const raw = m[0];
    const idx = m.index ?? 0;
    if (dates.has(raw) || [...dates].some((d) => d.includes(raw) && /[./]/.test(d))) continue;
    if (insideLongDigitRun(text, idx, raw.length)) continue;
    add(raw);
  }
  return [...out];
}

/**
 * Суммы, подписанные как деньги: со знаком валюты («999 ₸») или после
 * «Сумма…/Итого». Нули («Комиссия 0 ₸») тоже здесь: подписанное число в
 * чеке есть, и номер квитанции рядом уже не принимается за сумму.
 * Суммы в чужой валюте (при заданной currency) отброшены.
 */
export function labeledAmounts(text: string, currency?: string): number[] {
  const amount = `(?:${AMOUNT_TOKEN})${AMOUNT_DEC}`;
  const parse = (raw: string) => {
    const n = Number(raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null;
  };
  const tagged = currency ? extractTaggedCurrencyAmounts(text) : {};
  const foreign = new Set(
    Object.entries(tagged)
      .filter(([c]) => c !== currency)
      .flatMap(([, n]) => n),
  );
  const own = new Set(currency ? (tagged[currency] ?? []) : []);
  const out = new Set<number>();
  const add = (raw: string) => {
    const n = parse(raw);
    if (n != null && (own.has(n) || !foreign.has(n))) out.add(n);
  };
  for (const m of text.matchAll(new RegExp(`(${amount})\\s*${CURRENCY_TAIL}`, "gi")))
    add(m[1] ?? "");
  for (const m of text.matchAll(
    new RegExp(
      `(?:сумма(?:\\s+(?:операции|выплаты|перевода|платежа|в\\s+местной\\s+валюте))?|итого)\\s*[:\\-]?\\s*(${amount})`,
      "gi",
    ),
  ))
    add(m[1] ?? "");
  return [...out];
}

/** Суммы с явно подписанной валютой: «228 ₽» → RUB. */
export function extractTaggedCurrencyAmounts(text: string): Record<string, number[]> {
  const amount = `(?:${AMOUNT_TOKEN})${AMOUNT_DEC}`;
  const out: Record<string, number[]> = {};
  for (const [code, tail] of Object.entries(CURRENCY_AMOUNT_TAIL)) {
    const found = new Set<number>();
    for (const m of text.matchAll(new RegExp(`(${amount})\\s*${tail}`, "gi"))) {
      const n = parseAmountToken(m[1] ?? "");
      if (n != null) found.add(n);
    }
    if (found.size) out[code] = [...found];
  }
  return out;
}

/** Для сверки в валюте заказа не берём цифры, подписанные другой валютой. */
export function amountsForCurrency(text: string, currency?: string): number[] {
  const all = extractMoneyAmounts(text);
  if (!currency) return all;
  const tagged = extractTaggedCurrencyAmounts(text);
  const own = new Set(tagged[currency] ?? []);
  const foreign = new Set(
    Object.entries(tagged)
      .filter(([c]) => c !== currency)
      .flatMap(([, n]) => n),
  );
  return all.filter((n) => own.has(n) || !foreign.has(n));
}

export function detectReceiptCurrencies(text: string): string[] {
  const t = text.toLowerCase().replace(/ё/g, "е");
  return Object.entries(CURRENCY_MARKERS)
    .filter(([, ms]) => ms.some((m) => t.includes(m)))
    .map(([code]) => code);
}

export function looksLikeReceipt(text: string): boolean {
  if (looksLikeShopScreenNotReceipt(text)) return false;
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (t.replace(/\s+/g, "").length < 12) return false;
  const hits = RECEIPT_MARKERS.filter((m) => t.includes(m)).length;
  return hits >= 1 && extractMoneyAmounts(text).length >= 1;
}

export function findMatchingAmount(
  amounts: number[],
  expected: number,
  underpay = UNDERPAY_TOLERANCE,
): number | null {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const a of amounts) {
    const diff = (a - expected) / expected;
    // Копейка округления — не недоплата.
    if (a < expected * (1 - underpay) - 0.01 || diff > OVERPAY_TOLERANCE) continue;
    if (Math.abs(diff) < bestDiff) {
      best = a;
      bestDiff = Math.abs(diff);
    }
  }
  return best;
}

/** Чек старше этого числа суток (по календарю Алматы) автопроверка не принимает. */
export const RECEIPT_MAX_AGE_DAYS = 3;
/** Алматы — UTC+5 круглый год (с 2024). */
const ALMATY_OFFSET_MS = 5 * 3_600_000;

const MONTH_NAMES: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  қаңтар: 1,
  ақпан: 2,
  наурыз: 3,
  сәуір: 4,
  мамыр: 5,
  маусым: 6,
  шілде: 7,
  тамыз: 8,
  қыркүйек: 9,
  қазан: 10,
  қараша: 11,
  желтоқсан: 12,
};

/** Дни с 1970-01-01 для календарной даты; null, если такой даты нет. */
function dayNumber(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCMonth() !== m - 1) return null;
  return Math.floor(t / 86_400_000);
}

/**
 * Полные даты чека (с годом): 05.10.2026, 05.10.26, 2026-10-05, «5 октября 2026».
 * «05.10» без года и номера квитанции не даты. Результат — номера дней.
 */
export function extractFullDates(text: string): number[] {
  const t = text.toLowerCase().replace(/ё/g, "е");
  const out = new Set<number>();
  const add = (y: number, m: number, d: number) => {
    const n = dayNumber(y, m, d);
    if (n != null) out.add(n);
  };
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/g)) {
    const y = Number(m[3]);
    add(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1]));
  }
  for (const m of t.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g))
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s+([a-zа-яәіңғүұқөһ]+)\s+(\d{4})(?!\d)/g)) {
    const month = MONTH_NAMES[m[2] ?? ""];
    if (month) add(Number(m[3]), month, Number(m[1]));
  }
  return [...out];
}

/** Чек устарел: полные даты в нём есть, и все старше порога по календарю Алматы. */
export function isStaleReceipt(
  text: string,
  now: Date,
  maxAgeDays = RECEIPT_MAX_AGE_DAYS,
): boolean {
  const dates = extractFullDates(text);
  if (dates.length === 0) return false;
  const today = Math.floor((now.getTime() + ALMATY_OFFSET_MS) / 86_400_000);
  return dates.every((d) => today - d > maxAgeDays);
}

/** Реквизиты продавца, найденные в тексте способа оплаты: хвосты номеров и имя. */
export type RecipientHints = { tails: string[]; names: string[] };

const NAME_STOPWORDS = new Set(["ип", "тоо", "ао", "ооо", "kaspi", "gold", "карта", "карты"]);
const letterTokens = (s: string): string[] =>
  (
    s
      .toLowerCase()
      .replace(/ё/g, "е")
      .match(/[a-zа-яәіңғүұқөһ]{3,}/g) ?? []
  ).filter((w) => !NAME_STOPWORDS.has(w));

/**
 * Реквизиты продавца из свободного текста «как оплатить»: телефон (10–12
 * цифр) и карта (13–19 цифр) дают последние 4 цифры; имя — слова после
 * «Получатель:/ФИО:/Имя:». Чек Kaspi показывает имя и маскированный номер, поэтому
 * полный номер для сверки не нужен.
 */
export function recipientHintsFromInstructions(instructions: string): RecipientHints {
  const tails = new Set<string>();
  for (const m of instructions.matchAll(/\+?\d[\d\s().-]{8,24}\d/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 19) tails.add(digits.slice(-4));
  }
  const names = new Set<string>();
  for (const m of instructions.matchAll(
    /(?:получател[ьяю]?|фио|на\s+имя|имя|recipient|name|алушы)\s*[:-]\s*([^\n,;]{3,60})/gi,
  ))
    for (const w of letterTokens(m[1] ?? "")) names.add(w);
  return { tails: [...tails], names: [...names] };
}

export type RecipientCheck = "match" | "mismatch" | "unknown";

/**
 * Получатель в чеке против реквизитов продавца. «unknown» — сверять нечем:
 * в чеке нет блока получателя или нет данных того же вида (в реквизитах
 * только карта, а в чеке одно имя); такой чек проверяется по сумме, как раньше.
 * «mismatch» — в чеке есть сопоставимые данные получателя, и ни одно не
 * совпало: чек смотрит продавец.
 */
export function checkReceiptRecipient(text: string, hints: RecipientHints): RecipientCheck {
  if (hints.tails.length === 0 && hints.names.length === 0) return "unknown";
  const label = /(?:получател[ьяю]?|кому|recipient|алушы)\s*[:-]?\s*/i.exec(text);
  if (!label) return "unknown";
  const region = text.slice(label.index + label[0].length, label.index + label[0].length + 120);
  const nameSeg = region.split(/[\n\d*+]/, 1)[0] ?? "";
  const receiptNames = new Set(letterTokens(nameSeg));
  // Хвосты номеров в чеке: телефон или карта, целиком или с маской («*1234»,
  // «+7 705 ***-**-12-34»). Даты и суммы без маски и короче 10 цифр не берём.
  const receiptTails = new Set<string>();
  const noDates = region
    .replace(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
  for (const m of noDates.matchAll(/[+*•×]?\d?[\d\s().*•×-]{3,24}\d/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 4 && (/[*•×]/.test(m[0]) || digits.length >= 10))
      receiptTails.add(digits.slice(-4));
  }
  let compared = 0;
  if (hints.names.length > 0 && receiptNames.size > 0) {
    compared++;
    if (hints.names.some((n) => receiptNames.has(n))) return "match";
  }
  if (hints.tails.length > 0 && receiptTails.size > 0) {
    compared++;
    if (hints.tails.some((t) => receiptTails.has(t))) return "match";
  }
  return compared > 0 ? "mismatch" : "unknown";
}

export type ReceiptReason =
  | "recipient_mismatch"
  | "not_receipt"
  | "payment_failed"
  | "amount_mismatch"
  | "currency_mismatch"
  | "receipt_reused"
  | "ocr_unavailable"
  /** Все полные даты в чеке старше RECEIPT_MAX_AGE_DAYS по Алматы — чек смотрит продавец. */
  | "receipt_stale"
  /** Покупатель исчерпал автопроверки (src/core/receipts/attempts) — чек смотрит продавец. */
  | "check_limit";

export type ReceiptAnalysis =
  | {
      ok: true;
      matchedAmount: number;
      /** Валюта найденной суммы, если чек в чужой валюте и сверка шла по курсу. */
      matchedCurrency?: string;
    }
  | { ok: false; reason: ReceiptReason; detail: string };

/** Чек просим прислать заново; остальное — ручная проверка продавцом. */
export function isRetryReason(reason: ReceiptReason): boolean {
  return reason === "not_receipt" || reason === "payment_failed";
}

/** Разбор распознанного текста против суммы и валюты заказа. */
export function analyzeReceiptText(
  text: string,
  expectedAmount: number,
  currency?: string,
  opts: { underpay?: number; now?: Date } = {},
): ReceiptAnalysis {
  const underpay = opts.underpay ?? UNDERPAY_TOLERANCE;
  if (!text || text.trim().length < 8)
    return { ok: false, reason: "not_receipt", detail: "В файле почти нет текста." };
  if (looksLikeShopScreenNotReceipt(text))
    return {
      ok: false,
      reason: "not_receipt",
      detail: "Это скрин заказа, счёта к оплате или карточки товара — не чек банка.",
    };
  if (!looksLikeReceipt(text))
    return {
      ok: false,
      reason: "not_receipt",
      detail: "Текст не похож на чек оплаты (нет маркеров платежа).",
    };
  if (looksLikeFailedPayment(text))
    return {
      ok: false,
      reason: "payment_failed",
      detail: "В тексте чека банк пишет, что платёж не прошёл.",
    };
  // Пересохранённый старый чек на ту же сумму: автопроверка его не принимает,
  // решает продавец. Чек без полной даты этим правилом не отсекается.
  // Проверка включена, только если вызывающий передал `now` (счета подписки
  // сверяют даты со счётом сами, core/billing).
  if (opts.now && isStaleReceipt(text, opts.now))
    return {
      ok: false,
      reason: "receipt_stale",
      detail: `Все даты в чеке старше ${RECEIPT_MAX_AGE_DAYS} суток — возможно, это старый чек.`,
    };

  const cur = currency?.trim().toUpperCase() || undefined;
  if (underpay <= 0) {
    // Без недоплаты: если в чеке есть подписанные суммы, сверяем только с
    // ними, и любая подписанная сумма меньше заказа — к продавцу. Иначе
    // номер квитанции или «остаток» рядом с недоплатой сошёл бы за оплату.
    const labeled = labeledAmounts(text, cur);
    if (labeled.length > 0) {
      const short = labeled.filter((n) => n > 0 && n < expectedAmount - 0.01);
      if (short.length > 0)
        return {
          ok: false,
          reason: "amount_mismatch",
          detail: `В чеке сумма ${short.join(", ")}${cur ? ` ${cur}` : ""} меньше суммы заказа ${expectedAmount} (недоплата не принимается).`,
        };
      const hit = findMatchingAmount(labeled, expectedAmount, 0);
      if (hit != null) return { ok: true, matchedAmount: hit };
      if (!detectReceiptCurrencies(text).some((c) => c !== cur))
        return {
          ok: false,
          reason: "amount_mismatch",
          detail: `Сумма заказа ${expectedAmount}${cur ? ` ${cur}` : ""} не найдена среди сумм чека: ${labeled.join(", ")} (недоплата не принимается).`,
        };
    }
  }
  const matched = findMatchingAmount(amountsForCurrency(text, cur), expectedAmount, underpay);
  if (matched != null) return { ok: true, matchedAmount: matched };

  const foreign = detectReceiptCurrencies(text).filter((c) => c !== cur);
  const all = extractMoneyAmounts(text);
  if (cur && foreign.length > 0 && !detectReceiptCurrencies(text).includes(cur))
    return {
      ok: false,
      reason: "currency_mismatch",
      detail: `В чеке валюта ${foreign.join("/")}, заказ в ${cur} — нужна ручная проверка.`,
    };
  return {
    ok: false,
    reason: "amount_mismatch",
    detail: `Сумма заказа ${expectedAmount}${cur ? ` ${cur}` : ""} не найдена в чеке (${underpay > 0 ? `допуск −${Math.round(underpay * 100)}%…+${Math.round(OVERPAY_TOLERANCE * 100)}%` : "недоплата не принимается"}). Найдены: ${all.slice(0, 8).join(", ") || "—"}.`,
  };
}

/**
 * PDF начиная с метки «%PDF»: мусор перед ней (до 1024 байт, см.
 * orders/proof-file) Vision и разбор текста не понимают.
 */
export function pdfFromHeader(bytes: Uint8Array): Uint8Array {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const at = head.indexOf("%PDF");
  return at > 0 ? bytes.subarray(at) : bytes;
}

/** Фото, которые Vision не читает (HEIC, AVIF): такой чек сразу смотрит продавец. */
export function visionUnreadableImage(bytes: Uint8Array): boolean {
  const t = sniffProofMime(bytes);
  return t === "image/heic" || t === "image/avif";
}

export function isPdf(mime: string, bytes?: Uint8Array): boolean {
  if (mime.toLowerCase().includes("pdf")) return true;
  if (!bytes || bytes.length < 4) return false;
  // Те же правила, что при приёме файла чека: метка в первых 1024 байтах.
  return sniffProofMime(bytes) === "application/pdf";
}
