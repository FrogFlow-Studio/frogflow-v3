import type { Json } from "@/core/db-types";

export type Money = { amount: number; currency: string };

/** «1000 ₸», «4900 ₽», «12.50 USD» — одна функция на все каналы. */
export function formatMoney(amount: number | string, currency: string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  const value = Number.isFinite(n)
    ? Number.isInteger(n)
      ? String(n)
      : n.toFixed(2)
    : String(amount);
  const cur = (currency || "").toUpperCase();
  if (cur === "KZT") return `${value} ₸`;
  if (cur === "RUB") return `${value} ₽`;
  return `${value} ${currency}`;
}

/** «12500» → «12 500»: разряды неразрывным пробелом, дробная часть не трогается. */
export function groupThousands(value: string): string {
  const m = /^(-?)(\d+)(.*)$/.exec(value);
  if (!m) return value;
  const [, sign = "", digits = "", rest = ""] = m;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + rest;
}

/**
 * То же, что formatMoney, но с разрядами: «12 500 ₸». Для экранов панели и
 * витрины. Тексты бота и писем остаются на formatMoney: суммы оттуда
 * покупатель копирует в Kaspi, и неразрывный пробел там лишний.
 */
export function formatMoneyUi(amount: number | string, currency: string): string {
  const s = formatMoney(amount, currency);
  const i = s.indexOf(" ");
  // Знак валюты не отрывается от числа при переносе строки.
  return i < 0 ? groupThousands(s) : `${groupThousands(s.slice(0, i))}\u00a0${s.slice(i + 1)}`;
}

/**
 * Ручная цена страны из products.country_prices.
 * Форма админки пишет плоскую карту `{"KZ": 600}`; старый вид
 * `{"KZ": {price, currency}}` в живых данных не встречается, но разбирается —
 * цена в базе живёт годами, и падать на неё нельзя.
 */
export function manualCountryPrice(table: Json | null | undefined, code: string): number | null {
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;
  const entry = (table as Record<string, Json>)[code];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const amount = Number((entry as Record<string, Json>).price);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  const plain = Number(entry);
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}

/** Конвертация через курсы к USD (open.er-api.com отдаёт именно такую таблицу). */
export function convertViaUsd(
  amount: number,
  from: string,
  to: string,
  ratesToUsd: Record<string, number>,
): number | null {
  const f = ratesToUsd[from.toUpperCase()];
  const t = ratesToUsd[to.toUpperCase()];
  if (!f || !t || !Number.isFinite(f) || !Number.isFinite(t)) return null;
  if (from.toUpperCase() === to.toUpperCase()) return Math.round(amount);
  return Math.round((amount / f) * t);
}

/**
 * Перевод по курсу до копеек, без округления до целого — для сверки сумм.
 * Цены на витрине округляются до целого (convertViaUsd), но 700 ₸ ≈ 1,46 $
 * после такого округления становятся 1 $, и допуск по чеку съезжает на треть.
 */
export function convertViaUsdExact(
  amount: number,
  from: string,
  to: string,
  ratesToUsd: Record<string, number>,
): number | null {
  const f = ratesToUsd[from.toUpperCase()];
  const t = ratesToUsd[to.toUpperCase()];
  if (!f || !t || !Number.isFinite(f) || !Number.isFinite(t)) return null;
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  return Math.round((amount / f) * t * 100) / 100;
}
