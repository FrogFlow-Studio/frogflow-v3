import { localeFlags, localeNames, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { matchLocalePick } from "./numbers";

/** Шаги сценария: подсказки, корзина, выбор языка. */

/**
 * Текст выбора языка — сразу на всех четырёх: до выбора язык покупателя не
 * известен, показывать его на одном было бы гаданием. Кнопок у Instagram
 * три, языков четыре — поэтому нумерованный список; он работает и в папке
 * «Запросы сообщений», куда попадает весь трафик от неподписчиков.
 */
export function languagePickerText(): string {
  const lines = SUPPORTED_LOCALES.map((l, i) => `${i + 1}. ${localeFlags[l]} ${localeNames[l]}`);
  return (
    "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language:\n\n" +
    `${lines.join("\n")}\n\n` +
    "Ответьте номером. / Нөмірімен жауап беріңіз. / Raqami bilan javob bering. / Reply with the number."
  );
}

/**
 * Шаг сценария (страна, телефон, вариант…) ждёт ответа не дольше этого после
 * последней реплики бота. Позже реплика — уже не ответ на вопрос бота, а
 * обычная переписка с продавцом: «Россия» в ответ на его сообщение не должна
 * будить бота вопросом, заданным неделю назад (Educational Bot, 29.09).
 * Шаги оплаты не истекают: чек присылают и через день.
 */
export const STEP_TTL_MS = 3 * 3600_000;

const PAYMENT_STEPS = new Set(["awaiting_proof", "choose_pay", "awaiting_payment"]);

export function isStepStale(
  mode: string | undefined,
  lastReplyAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!mode || mode === "idle" || PAYMENT_STEPS.has(mode)) return false;
  const at = Date.parse(lastReplyAt ?? "");
  // Без отметки: выбор языка больше сам не задаётся — такой шаг остался от
  // прежнего сценария; остальные (переезд с v1 посреди оформления) не трогаем.
  if (!Number.isFinite(at)) return mode === "awaiting_locale";
  return now - at > STEP_TTL_MS;
}

/** Подсказка под списком товаров: номер — карточка, несколько — сразу в корзину. */
export const PRODUCT_LIST_HINT: Record<Locale, string> = {
  ru: "Напишите номер товара, чтобы посмотреть подробнее. Несколько номеров через запятую — положу их в корзину.",
  kk: "Толығырақ көру үшін тауар нөмірін жазыңыз. Бірнеше нөмірді үтір арқылы жазсаңыз — себетке саламын.",
  en: "Send a product number to see details. Several numbers separated by commas go straight to the cart.",
  uz: "Batafsil ko‘rish uchun mahsulot raqamini yozing. Bir nechta raqamni vergul bilan yozsangiz — savatga solaman.",
};

/** Несколько номеров в ответ на список разделов: открываем первый. */
export const ONE_SECTION_HINT: Record<Locale, string> = {
  ru: "Разделы открываются по одному — показываю первый. Другой раздел: «каталог».",
  kk: "Бөлімдер бір-бірден ашылады — біріншісін көрсетемін. Басқа бөлім: «каталог».",
  en: "Sections open one at a time — here is the first one. Another section: “catalog”.",
  uz: "Bo‘limlar bittadan ochiladi — birinchisini ko‘rsataman. Boshqa bo‘lim: «katalog».",
};

/** Склонение «товар» для русского счёта: 1 товар, 2 товара, 5 товаров. */
function ruItems(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "товар";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "товара";
  return "товаров";
}

/** Короткая сводка корзины для чата: «🛒 В корзине 3 товара на 12 400 ₸» (Б5). */
export function cartCardText(locale: Locale, count: number, total: string): string {
  switch (locale) {
    case "kk":
      return `🛒 Себетте ${count} тауар, сомасы ${total}`;
    case "en":
      return `🛒 ${count} ${count === 1 ? "item" : "items"} in your cart, ${total}`;
    case "uz":
      return `🛒 Savatda ${count} ta mahsulot, ${total}`;
    default:
      return `🛒 В корзине ${count} ${ruItems(count)} на ${total}`;
  }
}

/** Итог «несколько номеров»: что положили и что не нашли / нужно выбрать вариант. */
export const MULTI_ADD_COPY: Record<
  Locale,
  { notFound: (n: string[]) => string; needsVariant: (names: string[]) => string }
> = {
  ru: {
    notFound: (n) => `Не нашёл: ${n.join(", ")}.`,
    needsVariant: (names) => `Нужно выбрать вариант, откройте по номеру: ${names.join("; ")}.`,
  },
  kk: {
    notFound: (n) => `Табылмады: ${n.join(", ")}.`,
    needsVariant: (names) => `Нұсқасын таңдау керек, нөмірі бойынша ашыңыз: ${names.join("; ")}.`,
  },
  en: {
    notFound: (n) => `Not found: ${n.join(", ")}.`,
    needsVariant: (names) => `Choose an option — open by number: ${names.join("; ")}.`,
  },
  uz: {
    notFound: (n) => `Topilmadi: ${n.join(", ")}.`,
    needsVariant: (names) =>
      `Variantni tanlash kerak, raqami bo‘yicha oching: ${names.join("; ")}.`,
  },
};

/** Повтор цифры из списка языков сразу после выбора — не номер товара. */
export const LOCALE_PICK_ECHO_MS = 2 * 60 * 1000;

export function isLocalePickEcho(
  text: string,
  localePickedAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!matchLocalePick(text)) return false;
  const at = Date.parse(localePickedAt ?? "");
  if (!Number.isFinite(at)) return false;
  return now - at >= 0 && now - at < LOCALE_PICK_ECHO_MS;
}
