import type { Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import type { OrderEvent } from "./events";
import { safeTrackUrl } from "@/core/fulfillment/courier";

/**
 * Трек-номер посылки (Б12): продавец отправил заказ почтой или СДЭК и ответил
 * номером из Telegram. Ссылку строим только там, где формат номера однозначен
 * и страница отслеживания известна: СДЭК — 10 цифр, Казпочта — формат UPU
 * (две буквы, девять цифр, «KZ»); у Казпочты ссылка ведёт на сайт, номер
 * вводится там. Всё остальное — номер текстом без ссылки. Продавец может
 * ответить и готовой ссылкой https:// (например, из Яндекс Доставки).
 */
export type TrackCarrier = "cdek" | "kazpost" | null;

export type Tracking = {
  number: string | null;
  url: string | null;
  carrier: TrackCarrier;
};

/** Номер без пробелов и в верхнем регистре: 6–30 знаков, буквы, цифры, дефис, хотя бы одна цифра. */
export function normalizeTrackNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9-]{6,30}$/.test(v) && /\d/.test(v) ? v : null;
}

export function trackingFromText(raw: string | null | undefined): Tracking | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const link = safeTrackUrl(text);
  if (link) return { number: null, url: link, carrier: null };
  const number = normalizeTrackNumber(text);
  if (!number) return null;
  if (/^\d{10}$/.test(number))
    return {
      number,
      carrier: "cdek",
      url: `https://www.cdek.ru/ru/tracking?order_id=${number}`,
    };
  if (/^[A-Z]{2}\d{9}KZ$/.test(number))
    return { number, carrier: "kazpost", url: "https://post.kz/" };
  return { number, url: null, carrier: null };
}

/** Ключ «один раз»: тот же номер второй раз покупателю не уходит, исправленный — уходит. */
export function trackingKey(t: Tracking): string {
  return (t.number ?? t.url ?? "").slice(0, 80).replace(/[^A-Za-z0-9-]+/g, "_");
}

const CARRIER_NAME: Record<Exclude<TrackCarrier, null>, string> = {
  cdek: "СДЭК",
  kazpost: "Казпочта",
};

const MSG: Record<Locale, (no: string | number, t: Tracking) => string> = {
  ru: (no, t) =>
    [
      `📦 Ваш заказ #${no} отправлен.`,
      t.number
        ? `Трек-номер: ${t.number}${t.carrier ? ` (${CARRIER_NAME[t.carrier]})` : ""}`
        : null,
      t.url
        ? t.carrier === "kazpost"
          ? `Отследить: ${t.url} — введите номер на сайте.`
          : `Отследить: ${t.url}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  kk: (no, t) =>
    [
      `📦 №${no} тапсырысыңыз жөнелтілді.`,
      t.number
        ? `Трек-нөмір: ${t.number}${t.carrier ? ` (${CARRIER_NAME[t.carrier]})` : ""}`
        : null,
      t.url
        ? t.carrier === "kazpost"
          ? `Бақылау: ${t.url} — нөмірді сайтта енгізіңіз.`
          : `Бақылау: ${t.url}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  en: (no, t) =>
    [
      `📦 Your order #${no} has been shipped.`,
      t.number
        ? `Tracking number: ${t.number}${t.carrier ? ` (${CARRIER_NAME[t.carrier]})` : ""}`
        : null,
      t.url
        ? t.carrier === "kazpost"
          ? `Track it: ${t.url} — enter the number on the site.`
          : `Track it: ${t.url}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  uz: (no, t) =>
    [
      `📦 #${no}-buyurtmangiz joʻnatildi.`,
      t.number
        ? `Trek-raqam: ${t.number}${t.carrier ? ` (${CARRIER_NAME[t.carrier]})` : ""}`
        : null,
      t.url
        ? t.carrier === "kazpost"
          ? `Kuzatish: ${t.url} — raqamni saytda kiriting.`
          : `Kuzatish: ${t.url}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
};

export function trackingMessage(locale: Locale, no: string | number, t: Tracking): string {
  return MSG[locale](no, t);
}

export function trackingPayload(t: Tracking): Record<string, Json> {
  return { number: t.number, url: t.url, carrier: t.carrier };
}

/** Последний трек заказа из журнала — для страницы заказа. */
export function latestTracking(
  events: Array<Pick<OrderEvent, "kind" | "payload">>,
): Tracking | null {
  let last: Tracking | null = null;
  for (const e of events) {
    if (e.kind !== "tracking") continue;
    const number = typeof e.payload.number === "string" ? e.payload.number : null;
    const url = safeTrackUrl(typeof e.payload.url === "string" ? e.payload.url : null);
    if (!number && !url) continue;
    const c = e.payload.carrier;
    last = { number, url, carrier: c === "cdek" || c === "kazpost" ? c : null };
  }
  return last;
}
