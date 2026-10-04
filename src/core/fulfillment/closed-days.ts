import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict } from "@/core/settings/settings";
import { addDaysToIso, isoToDisplay, parseDateInput } from "./pure";

/**
 * Нерабочие дни выдачи: дни недели (1 — понедельник … 7 — воскресенье) и
 * отдельные даты или отрезки дат (праздники, отпуск). Живут в app_settings
 * (`fulfillment_closed_weekdays`, `fulfillment_closed_dates`), схема не
 * менялась. Пусто — выдача каждый день, как раньше.
 *
 * Модуль чистый: его читают бот, Direct/WhatsApp и сайт через
 * `core/fulfillment/fulfillment` — правило одно.
 */
export const CLOSED_WEEKDAYS_KEY = "fulfillment_closed_weekdays";
export const CLOSED_DATES_KEY = "fulfillment_closed_dates";
/** Потолок записей: список в настройках не должен разрастаться бесконечно. */
export const MAX_CLOSED_ENTRIES = 60;
const SEARCH_DAYS = 400;

export type ClosedRange = { from: string; to: string };
export type ClosedRules = { weekdays: number[]; ranges: ClosedRange[] };

export const NO_CLOSED_DAYS: ClosedRules = { weekdays: [], ranges: [] };

/** «6,7» → [6, 7]; всё, что не 1…7, и повторы отбрасываются. Закрыты все семь дней — нет правила (магазин не может не работать никогда). */
export function parseClosedWeekdays(raw: string | null | undefined): number[] {
  const set = new Set<number>();
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= 7) set.add(n);
  }
  const days = [...set].sort((a, b) => a - b);
  return days.length >= 7 ? [] : days;
}

function parseOneDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-");
    return parseDateInput(`${d}.${m}.${y}`);
  }
  return parseDateInput(t);
}

/**
 * Даты по строке или через запятую: «31.12.2026» или «2026-12-31»; отрезок —
 * «30.12.2026–03.01.2027» (через «–», «—» или «..»). Неразобранное и отрезок
 * с концом раньше начала отбрасываются; результат по возрастанию.
 */
export function parseClosedDates(raw: string | null | undefined): ClosedRange[] {
  const out: ClosedRange[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[\n,;]+/)) {
    const bits = part.split(/\s*(?:\.\.|–|—)\s*/);
    if (bits.length > 2) continue;
    const from = parseOneDate(bits[0] ?? "");
    const to = bits.length === 2 ? parseOneDate(bits[1] ?? "") : from;
    if (!from || !to || to < from) continue;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
}

/** Непустые куски, которые не стали датой: форма сообщает о них, а не молча теряет. */
export function unparsedClosedDates(raw: string | null | undefined): string[] {
  const bad: string[] = [];
  for (const part of (raw ?? "").split(/[\n,;]+/)) {
    if (!part.trim()) continue;
    if (parseClosedDates(part).length === 0) bad.push(part.trim());
  }
  return bad;
}

/**
 * Список к записи: отрезки, что закончились раньше `todayIso`, отбрасываются
 * (праздники прошлых лет не копятся); остальных больше потолка — отказ, а не
 * молчаливая потеря самых новых дат.
 */
export function prepareClosedDates(
  raw: string | null | undefined,
  todayIso: string,
): { ok: true; value: string } | { ok: false; count: number } {
  const live = parseClosedDates(raw).filter((r) => r.to >= todayIso);
  if (live.length > MAX_CLOSED_ENTRIES) return { ok: false, count: live.length };
  return { ok: true, value: serializeClosedDates(live) };
}

/** Запись в настройку: по строке, даты в ISO — их читает и parseClosedDates, и человек. */
export function serializeClosedDates(ranges: readonly ClosedRange[]): string {
  return ranges.map((r) => (r.from === r.to ? r.from : `${r.from}..${r.to}`)).join("\n");
}

export function parseClosedRules(
  weekdays: string | null | undefined,
  dates: string | null | undefined,
): ClosedRules {
  return { weekdays: parseClosedWeekdays(weekdays), ranges: parseClosedDates(dates) };
}

export const hasClosedDays = (r: ClosedRules) => r.weekdays.length > 0 || r.ranges.length > 0;

/** День недели ISO (1 — понедельник … 7 — воскресенье) календарной даты. */
export function isoWeekday(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay() || 7;
}

export function isClosedDay(iso: string, rules: ClosedRules): boolean {
  const day = iso.slice(0, 10);
  if (rules.weekdays.includes(isoWeekday(day))) return true;
  return rules.ranges.some((r) => day >= r.from && day <= r.to);
}

/** Ближайший рабочий день не раньше `fromIso`. */
export function nextOpenDay(fromIso: string, rules: ClosedRules): string {
  let day = fromIso.slice(0, 10);
  for (let i = 0; i < SEARCH_DAYS && isClosedDay(day, rules); i++) day = addDaysToIso(day, 1);
  return day;
}

/**
 * Самая ранняя дата выдачи. Срок изготовления считается рабочими днями:
 * нерабочие в него не входят (заказ в пятницу при выходных в сб–вс и сроке
 * 1 день — понедельник), а сама дата выдачи — всегда рабочая.
 */
export function earliestOpenDate(todayIso: string, leadDays: number, rules: ClosedRules): string {
  let day = todayIso.slice(0, 10);
  let left = Math.max(0, Math.floor(leadDays) || 0);
  for (let i = 0; left > 0 && i < SEARCH_DAYS; i++) {
    day = addDaysToIso(day, 1);
    if (!isClosedDay(day, rules)) left--;
  }
  return nextOpenDay(day, rules);
}

const WEEKDAY_SHORT: Record<string, readonly string[]> = {
  ru: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"],
  kk: ["дс", "сс", "ср", "бс", "жм", "сб", "жс"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  uz: ["du", "se", "chor", "pay", "ju", "sha", "yak"],
};

/** Короткая сводка для покупателя: «вс, 31.12.2026, 30.12.2026–03.01.2027». */
export function describeClosed(rules: ClosedRules, locale: string): string {
  const names = WEEKDAY_SHORT[locale] ?? WEEKDAY_SHORT.ru!;
  const parts = rules.weekdays.map((d) => names[d - 1]!);
  for (const r of rules.ranges)
    parts.push(
      r.from === r.to ? isoToDisplay(r.from) : `${isoToDisplay(r.from)}–${isoToDisplay(r.to)}`,
    );
  return parts.join(", ");
}

export async function closedRules(ctx: TenantContext): Promise<ClosedRules> {
  const s = await getSettingsStrict(ctx, [CLOSED_WEEKDAYS_KEY, CLOSED_DATES_KEY]);
  return parseClosedRules(s[CLOSED_WEEKDAYS_KEY], s[CLOSED_DATES_KEY]);
}
