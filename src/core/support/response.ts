import { parsePlan, type PlanTier } from "@/core/plans/registry";

/**
 * Скорость ответа поддержки. Считаем в рабочих минутах: команда отвечает по
 * будням, и «обращение в пятницу вечером ответили в понедельник утром» — это
 * минуты, а не двое суток. Рабочее время платформы — пн–пт 10:00–19:00 по
 * Алматы (WORK); это допущение вынесено в одну константу.
 */
export const WORK = {
  tz: "Asia/Almaty",
  startHour: 10,
  endHour: 19,
  days: [1, 2, 3, 4, 5],
} as const;

/** Цель первого ответа по тарифу, рабочих минут (внутренняя, продавцу не обещаем). */
export const RESPONSE_TARGET_MIN: Record<PlanTier, number> = {
  basic: 8 * 60,
  pro: 4 * 60,
  business: 2 * 60,
};

/** Меньше обращений — «обычно отвечаем» не пишем: цифра по двум случаям — не факт. */
export const MIN_SAMPLES = 5;
/** Окно данных для «обычно отвечаем» и доля: 80-й процентиль, а не среднее — обещание не выше факта. */
export const TYPICAL_WINDOW_DAYS = 30;
const TYPICAL_PERCENTILE = 0.8;
const MIN = 60_000;

export function targetMinutes(plan: string | null | undefined): number {
  const p = parsePlan(plan);
  return RESPONSE_TARGET_MIN[p?.kind === "tier" ? p.tier : "basic"];
}

/** Смещение пояса от UTC в минутах на момент `at`. */
function offsetMin(at: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / MIN);
}

/** Местная дата (год, месяц, день) момента. */
function localDate(at: number, tz: string): [number, number, number] {
  const o = offsetMin(at, tz);
  const d = new Date(at + o * MIN);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** Момент местного времени `hour:00` даты (y, m, d) в поясе tz. */
function localInstant(y: number, m: number, d: number, hour: number, tz: string): number {
  const naive = Date.UTC(y, m, d, hour);
  let at = naive - offsetMin(naive, tz) * MIN;
  at = naive - offsetMin(at, tz) * MIN;
  return at;
}

/** Рабочие окна [от, до) начиная с местного дня момента `from`, по одному на рабочий день. */
function* windows(from: number, tz = WORK.tz): Generator<[number, number]> {
  let [y, m, d] = localDate(from, tz);
  for (let i = 0; i < 800; i++) {
    const wd = new Date(Date.UTC(y, m, d)).getUTCDay();
    if ((WORK.days as readonly number[]).includes(wd))
      yield [localInstant(y, m, d, WORK.startHour, tz), localInstant(y, m, d, WORK.endHour, tz)];
    const next = new Date(Date.UTC(y, m, d + 1));
    [y, m, d] = [next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()];
  }
}

/** Рабочих минут между двумя моментами (b раньше a — 0). */
export function workingMinutesBetween(a: Date | string, b: Date | string): number {
  const from = new Date(a).getTime();
  const to = new Date(b).getTime();
  if (!(to > from)) return 0;
  let total = 0;
  for (const [s, e] of windows(from)) {
    if (s >= to) break;
    total += Math.max(0, Math.min(e, to) - Math.max(s, from));
  }
  return Math.round(total / MIN);
}

/** Момент, до которого надо ответить: `from` плюс `minutes` рабочих минут. */
export function addWorkingMinutes(from: Date | string, minutes: number): Date {
  const start = new Date(from).getTime();
  let left = minutes * MIN;
  for (const [s, e] of windows(start)) {
    const begin = Math.max(s, start);
    if (begin >= e) continue;
    if (left <= e - begin) return new Date(begin + left);
    left -= e - begin;
  }
  return new Date(start);
}

export type ResponseSample = { startedAt: string; respondedAt: string };

export const responseMinutes = (s: ResponseSample) =>
  workingMinutesBetween(s.startedAt, s.respondedAt);

/** Среднее первого ответа за окно (по моменту ответа); null — ответов не было. */
export function averageResponse(
  samples: ResponseSample[],
  now: Date,
  days: number,
): { count: number; avgMinutes: number | null } {
  const since = now.getTime() - days * 86_400_000;
  const mins = samples
    .filter((s) => Date.parse(s.respondedAt) >= since && Date.parse(s.respondedAt) <= now.getTime())
    .map(responseMinutes);
  return {
    count: mins.length,
    avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
  };
}

/**
 * «Обычно отвечаем за N рабочих часов»: 80-й процентиль первого ответа за
 * 30 дней, вверх до целого часа, не меньше часа. Мало данных — null (текста нет).
 */
export function typicalHours(samples: ResponseSample[], now: Date): number | null {
  const since = now.getTime() - TYPICAL_WINDOW_DAYS * 86_400_000;
  const mins = samples
    .filter((s) => Date.parse(s.respondedAt) >= since && Date.parse(s.respondedAt) <= now.getTime())
    .map(responseMinutes)
    .sort((a, b) => a - b);
  if (mins.length < MIN_SAMPLES) return null;
  const p = mins[Math.min(mins.length - 1, Math.ceil(mins.length * TYPICAL_PERCENTILE) - 1)]!;
  return Math.max(1, Math.ceil(p / 60));
}

export type PendingThread = {
  status: string;
  created_at: string;
  last_seller_message_at: string | null;
  last_operator_message_at: string | null;
  first_response_at: string | null;
  due_at: string | null;
};

/**
 * Срок ответа по обращению: ждёт ли оператора сообщение продавца и до какого
 * момента ответить. Если оператор уже поставил due_at — он главнее. Иначе
 * считаем от первого сообщения (первый ответ) или от последнего сообщения
 * продавца (повторное: самое раннее неотвеченное не хранится, считаем от
 * последнего — срок может оказаться чуть мягче факта).
 */
export function replyDue(
  t: PendingThread,
  plan: string | null | undefined,
  now: Date,
): { due: string; overdue: boolean } | null {
  if (t.status === "resolved" || !t.last_seller_message_at) return null;
  if (t.last_operator_message_at && t.last_operator_message_at >= t.last_seller_message_at)
    return null;
  const due =
    t.due_at ??
    addWorkingMinutes(
      t.first_response_at ? t.last_seller_message_at : t.created_at,
      targetMinutes(plan),
    ).toISOString();
  return { due, overdue: Date.parse(due) < now.getTime() };
}

/** Минуты — словами для оператора: «2 ч 15 мин». */
export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ч${m ? ` ${m} мин` : ""}` : `${m} мин`;
}
