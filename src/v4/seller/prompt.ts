import type { BuyerLang } from "./texts";

/**
 * Системный промпт ИИ-продавца v4. Поведение — из понимания модели, не из
 * правил по словам (принцип Якова 10.10): здесь только факты магазина и
 * короткие правила продажи. Условия оплаты и выдачи — только из анкеты
 * продавца, без подстановок в коде (CLAUDE.md).
 */

export type SellerProfile = {
  shop_name?: string;
  about?: string;
  payment_terms?: string;
  delivery_terms?: string;
  tone?: string;
};

export type Knowledge = { question: string; answer: string };

const LANG_NAME: Record<BuyerLang, string> = {
  ru: "русском",
  kk: "казахском",
  en: "английском",
  uz: "узбекском",
};

export function parseProfile(v: unknown): SellerProfile {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined);
  return {
    shop_name: pick("shop_name"),
    about: pick("about"),
    payment_terms: pick("payment_terms"),
    delivery_terms: pick("delivery_terms"),
    tone: pick("tone"),
  };
}

export function buildSellerPrompt(input: {
  profile: SellerProfile;
  knowledge: Knowledge[];
  country: string | null;
  lang: BuyerLang;
}): string {
  const p = input.profile;
  const lines = [
    `Ты — продавец магазина${p.shop_name ? ` «${p.shop_name}»` : ""} в переписке с покупателем. Твоя цель — помочь выбрать и купить.`,
    `Отвечай на языке покупателя; если непонятно — на ${LANG_NAME[input.lang]}. Коротко: 1–3 предложения.`,
    "Правила:",
    "1. Цены, товары и способы оплаты — только из инструментов. Ничего не выдумывай.",
    "2. Как только понятно, какой товар нужен, назови цену, способ оплаты и покажи кнопку через offer_card. Не спрашивай «Оформляем заказ?» — кнопка и есть оформление.",
    "3. Условия оплаты и выдачи — только из анкеты ниже. Если там ответа нет и в знаниях тоже — передай продавцу (hand_to_seller), не угадывай.",
    "4. Покупатель просит человека — hand_to_seller.",
    "5. Не может заплатить ни одним способом — cant_pay с причиной.",
    "6. Потерял купленное — cabinet_link.",
    `Страна покупателя: ${input.country ?? "неизвестна"}.`,
  ];
  if (p.tone) lines.push(`Тон: ${p.tone}`);
  lines.push("", "Анкета продавца:");
  lines.push(p.about ? `О магазине: ${p.about}` : "О магазине: не заполнено.");
  lines.push(p.payment_terms ? `Оплата: ${p.payment_terms}` : "Оплата: в анкете не заполнено.");
  lines.push(p.delivery_terms ? `Выдача: ${p.delivery_terms}` : "Выдача: в анкете не заполнено.");
  if (input.knowledge.length > 0) {
    lines.push("", "Ответы продавца на прошлые вопросы:");
    for (const k of input.knowledge) lines.push(`— ${k.question}\n  ${k.answer}`);
  }
  return lines.join("\n");
}

/** Спам в комментариях — без ИИ (решение 56): слова магазина и ссылки. */
export function isSpam(text: string, spamWords: string[]): boolean {
  const t = text.toLowerCase();
  if (/(https?:\/\/|t\.me\/|wa\.me\/)/.test(t)) return true;
  return spamWords.some((w) => w.trim() !== "" && t.includes(w.trim().toLowerCase()));
}
