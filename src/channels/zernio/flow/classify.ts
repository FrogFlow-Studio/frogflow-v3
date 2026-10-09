import { localeNames, type Locale } from "@/core/i18n/locale";
import { isDeliveryLangChoice, type DeliveryLangChoice } from "@/core/catalog/materials";
import {
  extractNumberList,
  extractPhoneDigits,
  extractProductNumber,
  taggedKeyword,
  taggedProductNumber,
} from "./numbers";
import { isAffirmative, isDismissal } from "./replies";

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

/** Оплата не идёт или нужен другой способ (из России, по номеру): Копилка, 09.10, заказ #46. */
export function isPayTrouble(text: string): boolean {
  return PAY_TROUBLE_MARKERS.test(text.trim());
}

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
  return null;
}
