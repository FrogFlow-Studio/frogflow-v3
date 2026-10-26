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
 * Вариант из offer_buy_button: каталог консультанта показывает варианты по
 * названию, без id, поэтому модель часто передаёт название («Папка МО ЕМН
 * для Казахстана»). Принимаем и id, и название без учёта регистра и пробелов.
 */
export function findOfferVariant<V extends { id: string; name?: string | null }>(
  variants: V[],
  idOrName: string | null | undefined,
): V | undefined {
  const key = (idOrName ?? "").trim();
  if (!key) return undefined;
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    variants.find((v) => v.id === key) ?? variants.find((v) => norm(v.name ?? "") === norm(key))
  );
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

/**
 * Одно напоминание с кнопкой «Купить» (настройка «напоминание с кнопкой
 * «Купить»»): человек получил кнопку и замолчал. Без вопроса и без нажима —
 * кнопка ещё раз, чтобы не искать её в переписке.
 */
export const BUY_REMINDER_TEXT: Record<Locale, (name: string) => string> = {
  ru: (n) => `Если ещё актуально, оставлю кнопку для «${n}»: одно нажатие — и пришлю оплату 👇`,
  kk: (n) =>
    `Әлі өзекті болса, «${n}» үшін батырманы осында қалдырамын: бір басыңыз, төлемді жіберемін 👇`,
  en: (n) =>
    `In case it's still relevant, here's the button for «${n}»: one tap and I'll send the payment 👇`,
  uz: (n) =>
    `Hali dolzarb bo‘lsa, «${n}» uchun tugmani shu yerda qoldiraman: bir marta bosing — to‘lovni yuboraman 👇`,
};
