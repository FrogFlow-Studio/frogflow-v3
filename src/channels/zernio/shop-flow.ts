import {
  isLocale,
  localeFlags,
  localeNames,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/core/i18n/locale";
import { isDeliveryLangChoice, type DeliveryLangChoice } from "@/core/catalog/materials";
import type { Json } from "@/core/db-types";

/**
 * Разбор реплик покупателя в Instagram Direct и WhatsApp — без побочных
 * действий, чтобы проверять тестом. Перенос `direct-flow.ts` v1 по описи
 * (docs/inherited-knowledge.md): что считать номером товара, выбором страны,
 * командой, отказом и жалобой на оплату. Ошибка в любом из этих решений
 * выглядит одинаково — «бот тупит», — а чинится в разных местах.
 */

const normalizeNumber = (raw: string) => {
  const normalized = raw.replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
};

/**
 * Номер телефона, а не коды товаров: «87770637152», «8 (777) 063-71-52»,
 * «+7 777 063 71 52», «+998 90 123 45 67». Код товара — до 5 цифр, поэтому
 * одна цифровая строка в 10–15 знаков кодом быть не может; с пробелами номер
 * узнаём по «+» или по форме «7/8 + 10 цифр» (так не спутать с «130 134 136 138»).
 * Список через запятую или «и» — это коды. Возвращает цифры (без «+»).
 */
export function extractPhoneDigits(text: string): string | null {
  const raw = text.trim();
  if (!/^\+?[\d\s().-]{9,24}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (/\d{6,}/.test(raw) || raw.startsWith("+")) return digits;
  const kz = digits.length === 11 && /^[78]/.test(digits);
  const short = digits.length === 10 && digits.startsWith("7");
  return kz || short ? digits : null;
}

/** «018», «18», «№18», «18.» — номер товара из поста; null — обычный текст. */
export function extractProductNumber(text: string): string | null {
  const cleaned = text.trim().replace(/^[№#]\s*/, "");
  const match = cleaned.match(/^(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]!) : null;
}

/**
 * Несколько номеров одним сообщением: «2 4 7», «2, 4, 7», «2\n4\n7», «#130 #134».
 * Покупатели так выбирают сразу несколько товаров из списка (Educational
 * Bot, 29.09). Одиночный номер — не список (его разбирает extractProductNumber).
 * Повторы убираются, больше 10 номеров не берём.
 */
export function extractNumberList(text: string): string[] | null {
  const raw = text.trim();
  // Больше пяти цифр подряд — не номер товара (телефон, счёт), резать на куски нельзя.
  if (/\d{6,}/.test(raw) || extractPhoneDigits(raw)) return null;
  if (!/^[№#]?\s*\d{1,5}(?:\s*[.)]?\s*(?:[,;+и]|and)?\s*[№#]?\s*\d{1,5})+\s*[.)]?$/iu.test(raw))
    return null;
  const numbers = Array.from(new Set((raw.match(/\d{1,5}/g) ?? []).map(normalizeNumber)));
  return numbers.length >= 2 ? numbers.slice(0, 10) : null;
}

/**
 * Код материала с решёткой внутри фразы: «Здравствуйте! Хочу материал #245».
 * Так продавец подписывает приветствие в рекламе «Написать в WhatsApp/Direct»:
 * без кода бот не знает, с какого ролика пришёл человек (Дидактика, 29.09).
 * Ровно один код — иначе это не выбор, а вопрос.
 */
export function taggedProductNumber(text: string): string | null {
  const codes = Array.from(
    new Set([...text.matchAll(/[#№]\s?(\d{1,5})(?!\d)/g)].map((m) => normalizeNumber(m[1]!))),
  );
  return codes.length === 1 ? codes[0]! : null;
}

/** Номер из названия: «018. Набор …», «236) Пазлы …», «081 | Дни недели», «165 Календари». */
export function productNumberFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.trim().match(/^(\d{1,5})(?:\s*[.)|]|\s+\S)/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** Номер из ключевых слов — только целым первым словом: «018, пазлы, …». */
export function productNumberFromKeywords(keywords: string | null | undefined): string | null {
  if (!keywords) return null;
  const match = keywords.trim().match(/^(\d{1,5})\s*,/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** «Убрать 018» — передумать по одной позиции, а не выкидывать всю корзину. */
export function parseRemoveCommand(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(?:убрать|убери|удали|удалить|минус|-)\s*[№#]?\s*(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** Какую позицию убрать: по номеру материала, потом по месту в показанном списке. */
export function pickCartLineToRemove(number: string, names: string[]): number | null {
  const byNumber = names.findIndex((name) => productNumberFromName(name) === number);
  if (byNumber >= 0) return byNumber;
  const position = Number(number);
  if (Number.isInteger(position) && position >= 1 && position <= names.length) return position - 1;
  return null;
}

/** Порядковый номер из показанного списка: «2», «2.», «2)». */
export function matchOrdinal(text: string, size: number): number | null {
  const m = text.trim().match(/^(\d{1,2})\s*[.)]?$/);
  if (!m) return null;
  const index = Number(m[1]) - 1;
  return index >= 0 && index < size ? index : null;
}

/**
 * Язык на первом шаге: порядковый номер (порядок SUPPORTED_LOCALES), код
 * («ru») или родное название целиком/с начала («Рус», «English»). Кнопок
 * у Instagram три, языков четыре — поэтому список текстом.
 */
export function matchLocalePick(text: string): Locale | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return SUPPORTED_LOCALES[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) => value.toLowerCase().replace(/[^\p{L}]+/gu, "");
  const needle = strip(raw);
  if (!needle) return null;
  if (isLocale(needle)) return needle;
  for (const locale of SUPPORTED_LOCALES) {
    const name = strip(localeNames[locale]);
    if (name === needle) return locale;
    if (needle.length >= 3 && name.startsWith(needle)) return locale;
  }
  return null;
}

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

/** После стольких нераспознанных ответов на выбор языка отвечаем на языке магазина, не держим человека на шаге вечно. */
export const MAX_LOCALE_MISSES = 2;

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

export type CountryOption = { code: string; name: string };

/**
 * Страна: порядковый номер из списка, название целиком или с начала (флаг
 * отбрасывается), код. Список у каждого клиента свой — из payment_methods.
 */
export function matchCountry(text: string, options: CountryOption[]): CountryOption | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return options[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const needle = strip(raw);
  if (!needle) return null;
  for (const option of options) {
    if (option.code.toLowerCase() === needle) return option;
    const name = strip(option.name);
    if (!name) continue;
    if (name === needle) return option;
    if (needle.length >= 4 && name.startsWith(needle)) return option;
  }
  return null;
}

export type ZoneOption = { id: string; name: string };

/** Зона доставки: порядковый номер или название целиком/с начала. */
export function matchZone(text: string, options: ZoneOption[]): ZoneOption | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return options[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const needle = strip(raw);
  if (!needle) return null;
  for (const option of options) {
    const name = strip(option.name);
    if (!name) continue;
    if (name === needle) return option;
    if (needle.length >= 3 && name.startsWith(needle)) return option;
  }
  return null;
}

/** Вложения, которые чеком не бывают: голосовое, видео, пересланный пост, эхо шаблона, сторис. */
const NOT_RECEIPT_TYPES = new Set([
  "audio",
  "voice",
  "video",
  "share",
  "ephemeral",
  "template",
  "sticker",
  "story",
  "story_mention",
  "story_reply",
  "ig_story",
  "reel",
  "ig_reel",
  "location",
  "contacts",
  "fallback",
]);
const RECEIPT_TYPES = new Set(["image", "photo", "file", "document"]);

/**
 * Какое вложение считать чеком. Сначала явная картинка или файл (по типу или
 * mime), потом — любое вложение незнакомого типа со ссылкой: Zernio уже
 * переименовывал типы, и новое имя не должно терять чек. Голосовое, видео,
 * пересланный пост и эхо шаблона чеком не считаются. Без типа — старые
 * события, всегда фото.
 */
export function pickReceiptAttachment(
  attachments: Array<{ url?: string; type?: string; mimeType?: string }> | null | undefined,
): string | null {
  const withUrl = (attachments ?? []).filter((a) => a.url);
  const typeOf = (a: { type?: string }) => a.type?.trim().toLowerCase() ?? "";
  const mimeOf = (a: { mimeType?: string }) => a.mimeType?.trim().toLowerCase() ?? "";
  const explicit = withUrl.find((a) => {
    const mime = mimeOf(a);
    return (
      !typeOf(a) ||
      RECEIPT_TYPES.has(typeOf(a)) ||
      mime.startsWith("image/") ||
      mime === "application/pdf"
    );
  });
  if (explicit) return explicit.url!;
  const unknown = withUrl.find((a) => {
    const mime = mimeOf(a);
    return (
      !NOT_RECEIPT_TYPES.has(typeOf(a)) && !mime.startsWith("audio/") && !mime.startsWith("video/")
    );
  });
  return unknown?.url ?? null;
}

/**
 * Нужен ли шаг «ваша почта» перед оформлением (перенос из v1). Instagram не
 * пересылает документы, поэтому цифровой заказ оттуда выдаётся письмом —
 * почта обязательна. В WhatsApp файлы приходят в переписку, почту
 * предлагаем с кнопкой «Без почты». Физический заказ, Telegram, уже
 * известная почта, отказ от неё или неготовая почта платформы — шага нет.
 */
export function emailStep(p: {
  platform: string;
  physical: boolean;
  knownEmail: string | null | undefined;
  skipped: boolean;
  mailReady: boolean;
}): "required" | "optional" | null {
  if (!p.mailReady || p.physical || p.knownEmail?.trim()) return null;
  if (p.platform === "instagram") return "required";
  if (p.platform === "whatsapp" && !p.skipped) return "optional";
  return null;
}

/** Почта — нестрого: поймать опечатку, а не отсеять экзотику по RFC. */
export function extractEmail(text: string): string | null {
  const match = text.trim().match(/[^\s<>()[\],;:@"]+@[^\s<>()[\],;:@"]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

const AFFIRMATIVES = new Set([
  "да",
  "да!",
  "ага",
  "угу",
  "хочу",
  "хочу!",
  "интересно",
  "интересует",
  "давайте",
  "давай",
  "+",
  "ок",
  "окей",
  "ok",
  "yes",
  "нужно",
  "надо",
]);

/** Односложное согласие — ответ воронке, а не поисковый запрос. */
export function isAffirmative(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return AFFIRMATIVES.has(normalized) || AFFIRMATIVES.has(`${normalized}!`);
}

const DISMISSALS = new Set([
  "нет",
  "не",
  "не нужно",
  "ненужно",
  "не надо",
  "ненадо",
  "не хочу",
  "неинтересно",
  "не интересно",
  "спасибо",
  "спс",
  "благодарю",
  "понятно",
  "понял",
  "поняла",
  "хорошо",
  "ясно",
  "всё",
  "все",
  "пока",
  "до свидания",
  "-",
]);

/** «Не нужно», «спасибо», «понятно» — разговор закрыт, а не начат заново. */
export function isDismissal(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!)»"]+$/g, "")
    .replace(/\s+/g, " ");
  return DISMISSALS.has(normalized);
}

const CANCEL_WORDS = new Set([
  "отмена",
  "отменить",
  "отмени",
  "стоп",
  "сброс",
  "сбросить",
  "заново",
  "начать заново",
  "/start",
  "/stop",
  "хватит",
  "cancel",
  "болдырмау",
  "bekor",
  "bekor qilish",
]);

/** Выход из сценария — работает на любом шаге, иначе на выборе страны можно запереться. */
export function isCancel(text: string): boolean {
  return CANCEL_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, ""),
  );
}

export type DirectCommand =
  "catalog" | "cart" | "checkout" | "orders" | "points" | "language" | "country" | "quiz";

const COMMANDS: Array<[DirectCommand, string[]]> = [
  [
    "quiz",
    [
      "подбор",
      "подобрать",
      "подбор товара",
      "подобрать товар",
      "квиз",
      "іріктеу",
      "тауар таңдау",
      "quiz",
      "find a product",
      "pick for me",
      "kviz",
      "tanlash",
      "mahsulot tanlash",
    ],
  ],
  [
    "catalog",
    [
      "/start",
      "start",
      "старт",
      "меню",
      "каталог",
      "магазин",
      "товары",
      "материалы",
      "начать",
      "бастау",
      "мәзір",
      "дүкен",
      "тауарлар",
      "материалдар",
      "menu",
      "catalog",
      "store",
      "products",
      "materials",
      "boshlash",
      "menyu",
      "do'kon",
      "do‘kon",
      "tovarlar",
      "materiallar",
    ],
  ],
  [
    "cart",
    [
      "корзина",
      "корзину",
      "моя корзина",
      "что в корзине",
      "что у меня в корзине",
      "себет",
      "себетке",
      "менің себетім",
      "себетімде не бар",
      "cart",
      "my cart",
      "what is in my cart",
      "savat",
      "savatga",
      "mening savatim",
      "savatimda nima bor",
    ],
  ],
  [
    "checkout",
    [
      "оформить",
      "оформить заказ",
      "оформляем",
      "оплатить",
      "оплата",
      "хочу оплатить",
      "как оплатить",
      "к оплате",
      "реквизиты",
      "тапсырысты рәсімдеу",
      "тапсырыс рәсімдеу",
      "төлеу",
      "төлем",
      "қалай төлеуге болады",
      "төлем деректемелері",
      "place order",
      "checkout",
      "pay",
      "payment",
      "how to pay",
      "payment details",
      "buyurtma berish",
      "buyurtmani rasmiylashtirish",
      "rasmiylashtirish",
      "to'lash",
      "to‘lash",
      "to'lov",
      "to‘lov",
      "qanday to'lash",
      "qanday to‘lash",
      "to'lov rekvizitlari",
      "to‘lov rekvizitlari",
    ],
  ],
  [
    "orders",
    [
      "мои заказы",
      "заказы",
      "мой заказ",
      "где мой заказ",
      "статус заказа",
      "менің тапсырыстарым",
      "тапсырыстар",
      "менің тапсырысым",
      "тапсырыс күйі",
      "my orders",
      "my order",
      "order status",
      "buyurtmalarim",
      "buyurtmalar",
      "buyurtmam",
      "buyurtma holati",
    ],
  ],
  [
    "points",
    [
      "баллы",
      "мои баллы",
      "сколько баллов",
      "бонусы",
      "мои бонусы",
      "ұпай",
      "ұпайлар",
      "менің ұпайларым",
      "қанша ұпай",
      "points",
      "my points",
      "how many points",
      "ball",
      "ballar",
      "mening ballarim",
      "ballarim",
      "nechta ball",
    ],
  ],
  ["language", ["язык", "тіл", "til", "language", "/language"]],
  ["country", ["страна", "ел", "country", "давлат", "/country", "валюта", "сменить страну"]],
];

/**
 * Команды сравниваются с целым сообщением: по вхождению «Я оплатила 400тг,
 * материал не отправили» становилось командой «оформить» и получало «Корзина
 * пуста».
 */
export function matchDirectCommand(text: string): DirectCommand | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^[«"]+|[»"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  for (const [command, words] of COMMANDS) if (words.includes(normalized)) return command;
  return null;
}

const PAID_MARKERS =
  /(оплат|заплат|перевел|перевёл|перевод|перечисл|скинул[аи]?\s*(деньги|оплат|чек)?|отправил[аи]?\s*(деньги|оплату|чек))/i;
const MISSING_MARKERS =
  /(не\s*(приш|дош|получ|отправ|присыл|скач|откры|работ|прош|отвеча)|ничего\s*(не|нет)|нет\s*(файл|материал|письм|ссылк)|где\s*(мой|моя|мои|файл|материал|заказ|ссылк|письм))/i;
const SUBJECT_MARKERS = /(материал|файл|заказ|письм|ссылк|доступ|товар)/i;
const REFUND_MARKERS =
  /(верн(и|ите|уть|ёте|ете)[^.!?]{0,24}(деньги|оплату|средства|деньгами)|возврат|обман|мошенн|развод|жалоб|полици|в\s*суд)/i;

/** Оплатил и не получил, требует деньги назад — единственный случай, когда бот зовёт человека немедленно. */
export function isPaymentComplaint(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (REFUND_MARKERS.test(value)) return true;
  if (!MISSING_MARKERS.test(value)) return false;
  return PAID_MARKERS.test(value) || SUBJECT_MARKERS.test(value);
}

export type IncomingKind =
  | { kind: "phone"; digits: string }
  | { kind: "product_number"; number: string }
  | { kind: "product_numbers"; numbers: string[] }
  | { kind: "affirmative" }
  | { kind: "dismissal" }
  | { kind: "question"; text: string };

/** Свободная реплика вне сценария: номер — в каталог, остальное — вопрос, а не молчаливый поиск. */
export function classifyIncoming(text: string): IncomingKind {
  const phone = extractPhoneDigits(text);
  if (phone) return { kind: "phone", digits: phone };
  const number = extractProductNumber(text);
  if (number !== null) return { kind: "product_number", number };
  const numbers = extractNumberList(text);
  if (numbers) return { kind: "product_numbers", numbers };
  const tagged = taggedProductNumber(text);
  if (tagged !== null) return { kind: "product_number", number: tagged };
  if (isDismissal(text)) return { kind: "dismissal" };
  if (isAffirmative(text)) return { kind: "affirmative" };
  return { kind: "question", text: text.trim() };
}

/** Instagram не рисует HTML — тексты ядра и Telegram-копии отдаём без тегов. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Ответ на «списать баллы?» при оформлении в Direct/WhatsApp: постбэк
 * `LOYALTY:yes|no`, текст кнопки или короткое «да»/«нет» на любом из
 * четырёх языков. Длинная реплика («нет, спасибо, не надо писать»), «спасибо»
 * и цифры — не выбор: шаг переспросит.
 */
export function matchLoyaltyPointsChoice(text: string): "yes" | "no" | null {
  const raw = text.trim().toLowerCase();
  if (raw === "loyalty:yes") return "yes";
  if (raw === "loyalty:no") return "no";
  const words = raw
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  const first = words[0]!;
  if (["да", "yes", "иә", "ия", "ha"].includes(first)) return "yes";
  if (["нет", "no", "жоқ", "жок", "yo'q", "yoq"].includes(first)) return "no";
  return null;
}

/**
 * Ответ на «на каком языке нужны материалы» до оформления: номер из
 * показанного списка (языки корзины, затем «все»), код или название языка,
 * «оба»/«все языки», постбэк кнопки `deliverylang:<код|all>`. Не путать с
 * matchLocalePick — тот выбирает язык интерфейса и нумерует все четыре.
 */
export function matchDeliveryLangChoice(text: string, langs: Locale[]): DeliveryLangChoice | null {
  const raw = text.trim().toLowerCase();
  if (!raw || langs.length === 0) return null;
  if (raw.startsWith("deliverylang:")) {
    const rest = raw.slice("deliverylang:".length);
    if (rest === "all") return "all";
    return isDeliveryLangChoice(rest) && langs.includes(rest as Locale) ? (rest as Locale) : null;
  }
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    if (index >= 0 && index < langs.length) return langs[index]!;
    if (index === langs.length) return "all";
    return null;
  }
  const strip = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const needle = strip(raw);
  if (!needle) return null;
  const allAliases = new Set([
    "all",
    "both",
    "оба",
    "обе",
    "все",
    "всеязыки",
    "барлық",
    "барлыктилдер",
    "hammasi",
    "barchatillar",
  ]);
  if (allAliases.has(needle) || /всеязык|обаязык|барлықтіл|barchatil/.test(needle)) return "all";
  if (
    new Set(["kz", "казахский", "казакша", "kazakh", "қазақ"]).has(needle) &&
    langs.includes("kk")
  )
    return "kk";
  for (const locale of langs) {
    if (needle === locale) return locale;
    const name = strip(localeNames[locale]);
    if (name === needle) return locale;
    if (needle.length >= 3 && name.startsWith(needle)) return locale;
  }
  return null;
}

/* ── WhatsApp: списки вместо нумерованного текста ─────────────────────
 * У Instagram три кнопки на сообщение, у WhatsApp — список до десяти строк:
 * категории, товары, страны и языки покупатель выбирает нажатием. Ответ
 * приходит `interactiveId` строки, и в нём — тот же postback, что у кнопки
 * (`CAT:`, `PROD:`), либо `STEP:<номер>` — ответ на текущий шаг сценария,
 * который разбирается как набранная цифра.
 */
export const STEP_PREFIX = "STEP:";
export const WA_LIST_MAX_ROWS = 10;
/** Строк под содержимое: остальное — «ещё», «корзина», «назад». */
export const WA_LIST_PAGE = WA_LIST_MAX_ROWS - 3;
const WA_ROW_TITLE_MAX = 24;
const WA_ROW_DESCRIPTION_MAX = 72;

export type WhatsAppListRow = { id: string; title: string; description?: string };
export type WhatsAppListSection = { title: string; rows: WhatsAppListRow[] };

/** Ответ строкой списка на шаг сценария — номер, как если бы его набрали текстом. */
export function stepAnswer(payload: string | null | undefined): string | null {
  if (!payload || !payload.startsWith(STEP_PREFIX)) return null;
  const v = payload.slice(STEP_PREFIX.length).trim();
  return v || null;
}

/** Обрезать заголовок строки: Meta режет перебор молча, лучше с многоточием. */
export function clipRowTitle(title: string, max = WA_ROW_TITLE_MAX): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Вторая строка товара в списке WhatsApp. Название длиннее заголовка строки
 * продолжается здесь — иначе «034. Декор на дверь к 1…» и «035. Декор на
 * дверь к 1…» неразличимы. Цена идёт после хвоста, если влезает; не влезает
 * вместе — хвост важнее: цену покупатель увидит в карточке, а чем товары
 * отличаются — уже нет (как rowSubtitle в v1).
 */
export function rowSubtitle(name: string, price: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  // Заголовок показывает первые WA_ROW_TITLE_MAX − 1 символов и «…» (clipRowTitle).
  const tail = t.length > WA_ROW_TITLE_MAX ? t.slice(WA_ROW_TITLE_MAX - 1).trim() : "";
  if (!tail) return price;
  const withPrice = `${tail} · ${price}`;
  if (withPrice.length <= WA_ROW_DESCRIPTION_MAX) return withPrice;
  return tail;
}

/** Родной interactive-объект Meta типа list; общий лимит строк — на всё сообщение. */
export function whatsappList(params: {
  body: string;
  buttonLabel: string;
  sections: WhatsAppListSection[];
  header?: string;
}): Json {
  let budget = WA_LIST_MAX_ROWS;
  const sections: WhatsAppListSection[] = [];
  for (const section of params.sections) {
    if (budget <= 0) break;
    const rows = section.rows.slice(0, budget).map((row) => ({
      id: row.id.slice(0, 200),
      title: clipRowTitle(row.title),
      ...(row.description
        ? { description: clipRowTitle(row.description, WA_ROW_DESCRIPTION_MAX) }
        : {}),
    }));
    if (rows.length === 0) continue;
    budget -= rows.length;
    sections.push({ title: clipRowTitle(section.title), rows });
  }
  return {
    type: "list",
    ...(params.header ? { header: { type: "text", text: params.header.slice(0, 60) } } : {}),
    body: { text: params.body.slice(0, 1024) },
    action: { button: params.buttonLabel.slice(0, 20), sections },
  } as unknown as Json;
}
