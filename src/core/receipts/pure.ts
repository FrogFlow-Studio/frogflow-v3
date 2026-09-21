/**
 * Проверка чека по распознанному тексту — чистые правила, без Vision и базы.
 * Допуск ±30%: OCR и банк часто дают сумму рядом с заказом (комиссия,
 * «сумма в местной валюте»), а скрин карточки товара на +150% не проходит.
 */
export const UNDERPAY_TOLERANCE = 0.3;
export const OVERPAY_TOLERANCE = 0.3;

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

export function findMatchingAmount(amounts: number[], expected: number): number | null {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const a of amounts) {
    const diff = (a - expected) / expected;
    if (diff < -UNDERPAY_TOLERANCE || diff > OVERPAY_TOLERANCE) continue;
    if (Math.abs(diff) < bestDiff) {
      best = a;
      bestDiff = Math.abs(diff);
    }
  }
  return best;
}

export type ReceiptReason =
  | "not_receipt"
  | "payment_failed"
  | "amount_mismatch"
  | "currency_mismatch"
  | "receipt_reused"
  | "ocr_unavailable";

export type ReceiptAnalysis =
  { ok: true; matchedAmount: number } | { ok: false; reason: ReceiptReason; detail: string };

/** Чек просим прислать заново; остальное — ручная проверка продавцом. */
export function isRetryReason(reason: ReceiptReason): boolean {
  return reason === "not_receipt" || reason === "payment_failed";
}

/** Разбор распознанного текста против суммы и валюты заказа. */
export function analyzeReceiptText(
  text: string,
  expectedAmount: number,
  currency?: string,
): ReceiptAnalysis {
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

  const cur = currency?.trim().toUpperCase() || undefined;
  const matched = findMatchingAmount(amountsForCurrency(text, cur), expectedAmount);
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
    detail: `Сумма заказа ${expectedAmount}${cur ? ` ${cur}` : ""} не найдена в чеке (допуск ±30%). Найдены: ${all.slice(0, 8).join(", ") || "—"}.`,
  };
}

export function isPdf(mime: string, bytes?: Uint8Array): boolean {
  if (mime.toLowerCase().includes("pdf")) return true;
  if (!bytes || bytes.length < 4) return false;
  return String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "%PDF";
}
