import type { Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";

/** Что сказать об акции покупателю: рассылка «Позвать» и напоминание «кончается завтра». */
export type SaleInfo = {
  /** Название товара или ««Торты»» для категории. */
  what: string;
  percent: number;
  newPrice: number | null;
  currency: string;
  endsAt: string;
  tz: string;
};

/** «12.10, 23:59» по часам магазина. */
export function saleUntil(endsAt: string, tz: string, locale: Locale): string {
  return new Date(endsAt).toLocaleString(locale === "en" ? "en-GB" : "ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DISCOUNT: Record<Locale, (i: SaleInfo) => string> = {
  ru: (i) =>
    i.newPrice != null ? `теперь ${formatMoney(i.newPrice, i.currency)}` : `−${i.percent} %`,
  kk: (i) =>
    i.newPrice != null ? `енді ${formatMoney(i.newPrice, i.currency)}` : `−${i.percent} %`,
  en: (i) =>
    i.newPrice != null ? `now ${formatMoney(i.newPrice, i.currency)}` : `−${i.percent} %`,
  uz: (i) =>
    i.newPrice != null ? `endi ${formatMoney(i.newPrice, i.currency)}` : `−${i.percent} %`,
};

export function announceText(i: SaleInfo, locale: Locale): string {
  const until = saleUntil(i.endsAt, i.tz, locale);
  const d = DISCOUNT[locale](i);
  return {
    ru: `🔥 Акция: ${i.what} — ${d} до ${until}. Загляните в каталог!`,
    kk: `🔥 Акция: ${i.what} — ${d}, ${until} дейін. Каталогқа кіріңіз!`,
    en: `🔥 Sale: ${i.what} — ${d} until ${until}. Take a look at the catalog!`,
    uz: `🔥 Aksiya: ${i.what} — ${d}, ${until} gacha. Katalogga kiring!`,
  }[locale];
}

/** День конца по календарю магазина: «сегодня» или «завтра» (позже напоминание не уходит). */
export function saleDay(endsAt: string, now: Date, tz: string): "today" | "tomorrow" {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  return day(new Date(endsAt)) === day(now) ? "today" : "tomorrow";
}

export function reminderText(i: SaleInfo, locale: Locale, day: "today" | "tomorrow"): string {
  const until = saleUntil(i.endsAt, i.tz, locale);
  const d = DISCOUNT[locale](i);
  const w = {
    ru: { today: "сегодня", tomorrow: "завтра" },
    kk: { today: "бүгін", tomorrow: "ертең" },
    en: { today: "today", tomorrow: "tomorrow" },
    uz: { today: "bugun", tomorrow: "ertaga" },
  }[locale][day];
  return {
    ru: `⏰ Акция заканчивается ${w}: ${i.what} — ${d}, до ${until}. Успейте заказать!`,
    kk: `⏰ Акция ${w} аяқталады: ${i.what} — ${d}, ${until} дейін. Үлгеріп тапсырыс беріңіз!`,
    en: `⏰ The sale ends ${w}: ${i.what} — ${d}, until ${until}. Order in time!`,
    uz: `⏰ Aksiya ${w} tugaydi: ${i.what} — ${d}, ${until} gacha. Ulgurib buyurtma bering!`,
  }[locale];
}
