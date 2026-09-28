/**
 * Товар из поста Instagram: название, цена и описание — из подписи, фото —
 * из поста. Разбор без модели: подписи продавцов однотипны («Торт Наполеон
 * 🎂 … Цена: 12 000 ₸ #торты»), а черновик продавец всё равно проверяет —
 * импорт создаёт товары скрытыми.
 */
export type PostDraft = {
  name: string;
  price: number | null;
  /** Валюта из подписи; null — не указана, берётся валюта магазина. */
  currency: string | null;
  description: string;
  /** Хештеги без «#» — в ключевые слова товара для поиска. */
  keywords: string;
};

const CURRENCIES: Array<[RegExp, string]> = [
  [/^(₸|тг\.?|тенге|tg|kzt)$/i, "KZT"],
  [/^(₽|р\.?|руб\.?|rub)$/i, "RUB"],
  [/^(сум|so['ʻ’]?m|uzs)$/i, "UZS"],
  [/^(\$|usd)$/i, "USD"],
];
const CUR_TOKEN = String.raw`(₸|тг\.?|тенге|tg|kzt|₽|руб\.?|р\.|rub|сум|so['ʻ’]?m|uzs|\$|usd)`;
const NUMBER = String.raw`(\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)(?:[.,](\d{1,2}))?`;
const WITH_CURRENCY = new RegExp(`${NUMBER}\\s*${CUR_TOKEN}(?![\\p{L}])`, "iu");
const CURRENCY_FIRST = new RegExp(`(?:^|\\s)(\\$)\\s?${NUMBER}`, "u");
const LABELLED = new RegExp(
  `(?:цена|стоимость|баға(?:сы)?|narxi|price)\\s*[:\\-–—]?\\s*${NUMBER}`,
  "iu",
);
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const MENTION = /@[\w.]+/g;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function toNumber(int: string, frac?: string): number {
  const n = Number(int.replace(/[ .\u00a0\u202f]/g, "")) + (frac ? Number(`0.${frac}`) : 0);
  return Math.round(n * 100) / 100;
}

function currencyOf(token: string): string | null {
  for (const [re, code] of CURRENCIES) if (re.test(token.trim())) return code;
  return null;
}

/** Цена из подписи: с валютой, «$ 25», затем «Цена: 12000» без валюты. */
export function parsePrice(text: string): { price: number; currency: string | null } | null {
  const m = WITH_CURRENCY.exec(text);
  if (m) return { price: toNumber(m[1]!, m[2]), currency: currencyOf(m[3]!) };
  const d = CURRENCY_FIRST.exec(text);
  if (d) return { price: toNumber(d[2]!, d[3]), currency: "USD" };
  const l = LABELLED.exec(text);
  if (l) return { price: toNumber(l[1]!, l[2]), currency: null };
  return null;
}

const clean = (s: string) =>
  s.replace(HASHTAG, "").replace(MENTION, "").replace(EMOJI, "").replace(/\s+/g, " ").trim();

export function parsePostCaption(caption: string | null | undefined): PostDraft {
  const text = (caption ?? "").replace(/\r/g, "");
  const price = parsePrice(text);
  const lines = text.split("\n").map(clean).filter(Boolean);
  // Название — первая строка, где есть буквы и нет цены.
  const first = lines.find((l) => /\p{L}/u.test(l) && !(price && parsePrice(l))) ?? lines[0] ?? "";
  const name = first.replace(/[\s:–—\-,.!]+$/u, "").slice(0, 80) || "Товар из Instagram";
  const tags = [...new Set((text.match(HASHTAG) ?? []).map((t) => t.slice(1).toLowerCase()))];
  const description = text
    .split("\n")
    .map((l) =>
      l
        .replace(HASHTAG, "")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .trim()
    .slice(0, 2000);
  return {
    name,
    price: price?.price ?? null,
    currency: price?.currency ?? null,
    description,
    keywords: tags.join(" ").slice(0, 500),
  };
}

/** Картинку поста скачиваем только с CDN Instagram/Facebook по https. */
export function isInstagramCdnUrl(raw: string | null | undefined): boolean {
  try {
    const u = new URL(raw ?? "");
    return (
      u.protocol === "https:" &&
      !u.username &&
      /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
}
