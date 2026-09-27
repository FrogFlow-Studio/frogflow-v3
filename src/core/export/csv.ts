/**
 * CSV для Excel и Google Таблиц: BOM (иначе кириллица — кракозябры),
 * разделитель «;» (в русской локали Excel запятая — десятичный знак),
 * \r\n, защита от формул. Настоящий .xlsx ради того же результата не нужен.
 */
export const BOM = "﻿";
export const SEP = ";";

/**
 * Экранирование по RFC 4180 плюс защита: Excel исполняет значение с =, +, -, @
 * (а табуляция и возврат каретки в начале перед ними — тоже, по OWASP).
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r"))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(SEP), ...rows.map((r) => r.map(cell).join(SEP))];
  return BOM + lines.join("\r\n");
}

/** «2026-09-21 14:05» в часовом поясе клиента. */
export function shopDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

function tzOffsetMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  // Intl отдаёт секунды без миллисекунд — сравниваем с целыми секундами.
  return (asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Граница дня клиента в UTC: «по 31 августа» значит весь этот день в его
 * поясе, а голая дата без зоны Postgres трактует как UTC.
 */
export function zonedDayToUtc(day: string, tz: string, endOfDay = false): string {
  const guess = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60_000).toISOString();
}
