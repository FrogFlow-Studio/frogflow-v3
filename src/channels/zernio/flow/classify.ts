import { localeNames, type Locale } from "@/core/i18n/locale";
import { isDeliveryLangChoice, type DeliveryLangChoice } from "@/core/catalog/materials";
import {
  extractNumberList,
  extractPhoneDigits,
  extractProductNumber,
  localeFromWords,
  taggedKeyword,
  taggedProductNumber,
} from "./numbers";
import { isAffirmative, isDismissal } from "./replies";

export { isPaidReport } from "@/core/payments/paid-report";

/** Вид входящего сообщения и выборы покупателя. */

const PAID_MARKERS =
  /(оплат|заплат|перевел|перевёл|перевод|перечисл|скинул[аи]?\s*(деньги|оплат|чек)?|отправил[аи]?\s*(деньги|оплату|чек))/i;

const MISSING_MARKERS =
  /(не\s*(приш|дош|получ|отправ|присыл|скач|откры|работ|прош|отвеча)|ничего\s*(не|нет)|нет\s*(файл|материал|письм|ссылк)|где\s*(мой|моя|мои|файл|материал|заказ|ссылк|письм))/i;

const SUBJECT_MARKERS = /(материал|файл|заказ|письм|ссылк|доступ|товар)/i;

const REFUND_MARKERS =
  /(верн(и|ите|уть|ёте|ете)[^.!?]{0,24}(деньги|оплату|средства|деньгами)|возврат|обман|мошенн|развод|жалоб|полици|в\s*суд)/i;

const PAY_TROUBLE_MARKERS =
  /(не\s*(смог|могу|можу|получ|проход|прош|выход|нажима|открыва)\p{L}*\s*(оплат|заплат|перев)|не\s*(нажима|открыва)|(оплат|заплат)\p{L}*\s*не\s*(смог|могу|получ|прош|проход|выход)|из\s*росси|рубл|сбп|по\s*номеру|перевод\p{L}*\s*по\s*номеру|российск\p{L}*\s*карт|карт\p{L}*\s*(рф|росси))/iu;

/**
 * Покупатель не из Казахстана («Я из Беларуси», «живу в Узбекистане») или
 * без Kaspi: реквизиты Kaspi ему не подходят, нужен продавец (заказ #62
 * Копилки, 09.10). Россия — в PAY_TROUBLE_MARKERS.
 */
const ABROAD_MARKERS =
  /((^|[^\p{L}])(из|с|в|во|живу\s*в)\s+(беларус|белорус|узбекистан|кыргызстан|киргиз|нукус|ташкент|самарканд|бухар|андижан|наманган|ферган|хорезм|ургенч|каракалпак|бишкек|минск|гомел|брест|витебск|гродн|могил|украин|армени|грузи|молдов|таджикистан|туркмени|азербайджан|германи|израил|польш|латви|литв|эстони|турци|сша|америк|европ|канад|чехи|итали|испани|франци|великобритани)\p{L}*|(^|[^\p{L}])рб($|[^\p{L}])|белорусск\p{L}*\s*карт|не\s*из\s*казахстан|(нет|без)\s*(kaspi|каспи)|(kaspi|каспи)\p{L}*\s*нет)/iu;

/**
 * Покупатель из России: страна, рубли или город и регион РФ («Я с Дагестана»,
 * «из Москвы»). Ему подходит форма Продамуса картой РФ (route, #82).
 */
const RUSSIA_MARKERS =
  /(росси|рубл|сбп|(^|[^\p{L}])рф($|[^\p{L}])|(^|[^\p{L}])(из|с|со|в|во|живу\s*в)\s+(москв|петербург|питер|спб|новосибирск|екатеринбург|казан[иь]|дагестан|махачкал|чечн|грозн|краснодар|ростов|самар[аыеу](?!\p{L})|омск|томск|сибир|крым|подмосков|воронеж|волгоград|саратов|челябинск|тюмен|перм[ьи](?!\p{L})|нижн\p{L}*\s*новгород))/iu;

export function isFromRussia(text: string): boolean {
  return RUSSIA_MARKERS.test(text.trim());
}

/** Оплата не идёт или нужен другой способ (из России, по номеру): Копилка, 09.10, заказ #46. */
export function isPayTrouble(text: string): boolean {
  const t = text.trim();
  return PAY_TROUBLE_MARKERS.test(t) || ABROAD_MARKERS.test(t) || RUSSIA_MARKERS.test(t);
}

/**
 * «Как прислать чек?» после реквизитов: «Не знаю как», «как отправить чек»,
 * «куда скинуть скрин» (заказ #72 Копилки, 10.10 — бот промолчал).
 * Только на шаге «жду чек» (route): там голое «не знаю как» — про чек.
 */
const RECEIPT_HOW =
  /((как|куда|каким\s*образом)\s*(мне\s*|вам\s*)?(его\s*|её\s*|ее\s*)?(отправ|присл|присыл|скин|скид|прикреп|загруз|выслат|высыл|кинут|переслат|сбросит)\p{L}*(\s*(вам|сюда|тут|здесь))?(\s*(его|её|ее|чек\p{L}*|скрин\p{L}*|фото\p{L}*|квитанц\p{L}*|pdf))?\s*[?.!)]*$|(как|куда)\s*(мне\s*)?(чек|скрин|квитанц|фото\s*чек)|не\s*(получается|могу|выходит|умею)\s*(отправ|присл|прикреп|скин|загруз)\p{L}*\s*(чек|скрин|фото|квитанц)|(чек|скрин)\p{L}*\s*(қалай|qanday)|(қалай|qanday)\s*(жібер|yubor)|how\s*(do\s*i|to|can\s*i)\s*(send|attach|upload)|where\s*(do\s*i|to|can\s*i)\s*send)/iu;

const BARE_DONT_KNOW =
  /^[\s(]*(а|но|я)?\s*(не\s*знаю|не\s*понимаю|не\s*поняла?|не\s*разобрал[аи]?с[ья]|білмеймін|түсінбедім|bilmayman|tushunmadim|i\s*don['’]?t\s*know|don['’]?t\s*know)\s*(как|қалай|qanday|how)?[\s.!?)(:]*$/iu;

export function isReceiptHowQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 160) return false;
  return RECEIPT_HOW.test(t) || BARE_DONT_KNOW.test(t);
}

/** Короткие подписи URL-кнопки «Открыть оплату» в Direct/WhatsApp. */
const OPEN_PAYMENT_ACTION =
  /^(?:открыть(?:\s+ссылку(?:\s+на)?)?\s+оплат\p{L}*|перейти\s+(?:к\s+)?оплат\p{L}*|продолжить\s+оплат\p{L}*|оплатить(?:\s+сейчас)?|open\s+(?:the\s+)?payment|continue\s+to\s+pay|pay\s+now)$/iu;

export function isOpenPaymentAction(text: string): boolean {
  const value = text
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  return value.length <= 80 && OPEN_PAYMENT_ACTION.test(value);
}

/** «Не получается оплатить», «оплата не проходит» — ещё не оплатил, это не жалоба (Копилка 12.10, #131). */
const CANT_PAY_MARKERS =
  /(не\s*(смог|могу|можу|получ|проход|прош|выход)\p{L}*\s*(оплат|заплат|перев)|(оплат|заплат)\p{L}*\s*не\s*(смог|могу|получ|прош|проход|выход))/iu;

/** Оплатил и не получил, требует деньги назад — единственный случай, когда бот зовёт человека немедленно. */
export function isPaymentComplaint(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (REFUND_MARKERS.test(value)) return true;
  if (CANT_PAY_MARKERS.test(value)) return false;
  if (!MISSING_MARKERS.test(value)) return false;
  return PAID_MARKERS.test(value) || SUBJECT_MARKERS.test(value);
}

export type IncomingKind =
  | { kind: "phone"; digits: string }
  | { kind: "product_number"; number: string }
  | { kind: "product_numbers"; numbers: string[] }
  | { kind: "product_tag"; tag: string }
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
  const tag = taggedKeyword(text);
  if (tag !== null) return { kind: "product_tag", tag };
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
  // «На русском», «по-казахски» (AATeach 11.10).
  const worded = localeFromWords(raw);
  return worded && langs.includes(worded) ? worded : null;
}
