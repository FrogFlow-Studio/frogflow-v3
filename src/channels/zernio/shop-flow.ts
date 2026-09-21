import { isLocale, localeNames, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { isDeliveryLangChoice, type DeliveryLangChoice } from "@/core/catalog/materials";

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

/** «018», «18», «№18», «18.» — номер товара из поста; null — обычный текст. */
export function extractProductNumber(text: string): string | null {
  const cleaned = text.trim().replace(/^[№#]\s*/, "");
  const match = cleaned.match(/^(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]!) : null;
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

/**
 * Какое вложение считать чеком: картинка или файл. Типы — из живых событий
 * (image, template, audio, video, share, ephemeral, file); голосовое и
 * пересланный пост чеком не являются. Без типа — старые события, всегда фото.
 */
export function pickReceiptAttachment(
  attachments: Array<{ url?: string; type?: string; mimeType?: string }> | null | undefined,
): string | null {
  for (const item of attachments ?? []) {
    if (!item.url) continue;
    const type = item.type?.trim().toLowerCase();
    const mime = item.mimeType?.trim().toLowerCase();
    if (
      !type ||
      ["image", "photo", "file", "document"].includes(type) ||
      mime?.startsWith("image/") ||
      mime === "application/pdf"
    )
      return item.url;
  }
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

export type DirectCommand = "catalog" | "cart" | "checkout" | "orders" | "language" | "country";

const COMMANDS: Array<[DirectCommand, string[]]> = [
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
  | { kind: "product_number"; number: string }
  | { kind: "affirmative" }
  | { kind: "dismissal" }
  | { kind: "question"; text: string };

/** Свободная реплика вне сценария: номер — в каталог, остальное — вопрос, а не молчаливый поиск. */
export function classifyIncoming(text: string): IncomingKind {
  const number = extractProductNumber(text);
  if (number !== null) return { kind: "product_number", number };
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
