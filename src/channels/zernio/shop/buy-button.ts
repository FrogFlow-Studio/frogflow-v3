import type { Locale } from "@/core/i18n/locale";

/**
 * Кнопка «Купить» под ответом ИИ-консультанта (настройка канала «Кнопка
 * «Купить» в ответе консультанта»). Покупатель пришёл с готовым выбором
 * («Интересует папка классного руководителя»), а бот спрашивал «Оформляем
 * заказ?» — 18 из 25 таких покупателей Копилки молчали дальше (21–25.10).
 * Нажатие кнопки — явное согласие: сразу заказ и оплата, без второго вопроса.
 */
const PREFIX = "CBUY";

export const BUY_BUTTON_TITLE: Record<Locale, string> = {
  ru: "🛒 Купить",
  kk: "🛒 Сатып алу",
  en: "🛒 Buy",
  uz: "🛒 Sotib olish",
};

export function buyButtonPayload(productId: string, variantId?: string | null): string {
  return variantId ? `${PREFIX}:${productId}:${variantId}` : `${PREFIX}:${productId}`;
}

/**
 * Сколько знаков текста отправляем вместе с кнопкой: Instagram берёт не
 * больше 640 (длиннее режется), у WhatsApp тело кнопочного сообщения —
 * до 1024. Длиннее — текст отдельно, кнопка следующим коротким сообщением.
 */
export function buyButtonTextMax(platform: string): number {
  return platform === "instagram" ? 600 : 1000;
}

/** Короткая строка над кнопкой, когда ответ консультанта ушёл отдельно. */
export const BUY_BUTTON_LEAD: Record<Locale, string> = {
  ru: "Нажмите, чтобы оформить и оплатить 👇",
  kk: "Рәсімдеп, төлеу үшін басыңыз 👇",
  en: "Tap to order and pay 👇",
  uz: "Rasmiylashtirish va to‘lash uchun bosing 👇",
};

/** Текст нажатой кнопки «Купить» на любом языке (без учёта пробелов). */
export function isBuyButtonTitle(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return Object.values(BUY_BUTTON_TITLE).some((title) => title === t);
}
