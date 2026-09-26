/**
 * Сверка чисел в ответе консультанта с тем, что модель видела (перенос
 * validateConsultantReply из v1). Правило в подсказке «цены только из
 * каталога» модель иногда нарушает; здесь выдуманная цена или стоимость
 * доставки не уходит покупателю.
 *
 * Известными считаются: цены каталога, их суммы по 2–3 (наборы, «два
 * полотенца»), любые числа из каталога, базы знаний, условий продавца и
 * слов клиента. Телефоны и годы пропускаются. Число без валюты меньше 1000
 * не проверяется (размеры, штуки, дни); рядом с валютой — проверяется любое.
 */

const CURRENCY = "(?:₸|тг\\.?|тенге|₽|руб\\.?|рубл\\w*|\\$|usd|kzt|rub|сум|so['‘’]?m|сом|€|eur)";
const NUMBER_RE = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g;
const YEAR_RE = /\b20[2-3]\d\b(?!\s*(?:₸|тг|тенге|₽|руб|\$|usd|kzt))/gi;
const SHIPPING_RE = /доставк\w*|shipping|жеткізу/i;

const key = (n: number) => String(Math.round(n * 100) / 100);

function parseNumber(raw: string): number {
  let s = raw.replace(/[ \u00a0\u202f]/g, "");
  // «45,000» и «45.000» — разделитель тысяч; «97,5» и «97.50» — дробь.
  s = /^\d{1,3}[.,]\d{3}$/.test(s) ? s.replace(/[.,]/, "") : s.replace(",", ".");
  return Number(s);
}

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map(parseNumber).filter(Number.isFinite);
}

export function knownNumbers(input: { prices: number[]; texts: string[] }): Set<string> {
  const known = new Set<string>();
  for (const t of input.texts) for (const n of numbersIn(t)) known.add(key(n));
  const prices = [...new Set(input.prices.filter((p) => Number.isFinite(p) && p > 0))].slice(
    0,
    400,
  );
  for (let i = 0; i < prices.length; i++) {
    known.add(key(prices[i]!));
    for (let j = i; j < prices.length; j++) {
      const two = prices[i]! + prices[j]!;
      known.add(key(two));
      for (let k = j; k < prices.length && k < i + 4; k++) known.add(key(two + prices[k]!));
    }
    known.add(key(prices[i]! * 3));
  }
  return known;
}

export type FactCheck = { ok: true } | { ok: false; reason: string };

export function checkReplyFacts(reply: string, known: Set<string>): FactCheck {
  const text = reply.replace(PHONE_RE, " ").replace(YEAR_RE, " ");
  const re = new RegExp(NUMBER_RE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = parseNumber(m[0]);
    if (!Number.isFinite(n) || known.has(key(n))) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const money =
      new RegExp(`^\\s*${CURRENCY}`, "i").test(after) ||
      new RegExp(`${CURRENCY}\\s*$`, "i").test(before);
    // Сумма у слова «доставка» в том же предложении — стоимость доставки.
    const shipping = SHIPPING_RE.test(before.split(/[.!?\n]/).pop() ?? "");
    if (shipping && (money || n >= 100))
      return { ok: false, reason: `стоимость доставки ${m[0].trim()} не из условий продавца` };
    if (money || n >= 1000) return { ok: false, reason: `цена ${m[0].trim()} не из каталога` };
  }
  return { ok: true };
}
