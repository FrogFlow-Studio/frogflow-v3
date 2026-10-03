import { lessonsAccess, type LessonAccess } from "./access";
import type { Course } from "./course";

export {
  ACCESS_DAYS_MAX,
  COHORT_TITLE_MAX,
  COHORTS_MAX,
  LOCAL_DAY_RE,
  LOCAL_START_RE,
} from "./course";

/**
 * Потоки и тарифы курса (ниша «Онлайн-школа»). Чистый модуль.
 *
 * Поток — общая дата старта: все купившие в его набор начинают вместе,
 * уроки открываются по календарю потока, опоздавший сразу видит уже
 * открытые. Без потоков курс проходится с момента покупки (как раньше).
 *
 * Тариф — вариант товара: что входит (проверка ДЗ, закрытый канал) и
 * сколько дней открыт доступ. Лимит мест — остаток товара (модуль stock).
 */
export type Cohort = {
  id: string;
  title: string;
  /** Старт в поясе магазина: «YYYY-MM-DDTHH:MM». */
  start: string;
  /** Последний день набора (включительно) в поясе магазина; null — до старта. */
  enrollUntil: string | null;
  /**
   * Групповой чат потока в Telegram (id -100… или @имя): отдельная группа
   * на поток, личные ссылки и исключение — как у канала курса.
   */
  chat?: string | null;
};

export type Tariff = {
  /** Проверка домашних заданий преподавателем. */
  homework: boolean;
  /** Личная ссылка в закрытый канал курса. */
  channel: boolean;
  /** Сколько дней от старта открыт доступ; null — бессрочно. */
  accessDays: number | null;
};

export const DEFAULT_TARIFF: Tariff = { homework: true, channel: true, accessDays: null };

/** Смещение пояса в мс для момента `at`. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Местное время магазина («YYYY-MM-DDTHH:MM») → момент. */
export function localToInstant(local: string, tz: string): Date {
  const guess = new Date(`${local}:00.000Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  // Второй проход — на случай перехода на летнее время между догадкой и ответом.
  return new Date(guess.getTime() - tzOffsetMs(first, tz));
}

export function cohortStart(c: Cohort, tz: string): Date {
  return localToInstant(c.start, tz);
}

/** До какого момента идёт набор в поток: конец дня enrollUntil или старт. */
export function enrollDeadline(c: Cohort, tz: string): Date {
  if (!c.enrollUntil) return cohortStart(c, tz);
  return new Date(localToInstant(`${c.enrollUntil}T23:59`, tz).getTime() + 59_999);
}

const byStart = (tz: string) => (a: Cohort, b: Cohort) =>
  cohortStart(a, tz).getTime() - cohortStart(b, tz).getTime();

/** Поток для покупки: ближайший, чей набор ещё шёл в момент покупки. */
export function cohortForPurchase(course: Course, boughtAt: Date, tz: string): Cohort | null {
  const list = [...(course.cohorts ?? [])].sort(byStart(tz));
  if (list.length === 0) return null;
  return (
    list.find((c) => enrollDeadline(c, tz).getTime() >= boughtAt.getTime()) ??
    // Купили после конца всех наборов (продавец не закрыл продажу) — в последний поток.
    list.at(-1)!
  );
}

/** Можно ли сейчас купить курс: без потоков — всегда, с потоками — пока идёт набор. */
export function enrollOpen(course: Course, now: Date, tz: string): boolean {
  const list = course.cohorts ?? [];
  return list.length === 0 || list.some((c) => enrollDeadline(c, tz).getTime() >= now.getTime());
}

/** Поток, в который идёт набор сейчас (для витрины: «старт 15 октября»). */
export function enrollingCohort(course: Course, now: Date, tz: string): Cohort | null {
  const list = [...(course.cohorts ?? [])].sort(byStart(tz));
  return list.find((c) => enrollDeadline(c, tz).getTime() >= now.getTime()) ?? null;
}

export function tariffFor(course: Course, variantId: string | null | undefined): Tariff {
  return (variantId && course.tariffs?.[variantId]) || { ...DEFAULT_TARIFF };
}

export type TimelineInput = {
  course: Course;
  run: { startedAt: string; cohortId?: string; until?: string } | null;
  /** Когда куплено (создан заказ): по нему выбирается поток. */
  boughtAt: string;
  variantId: string | null;
};

export type Timeline = {
  /** Отсчёт расписания: старт потока или начало прохождения. */
  start: string;
  cohort: Cohort | null;
  tariff: Tariff;
  /** До когда открыт доступ; null — бессрочно. */
  expiresAt: string | null;
  expired: boolean;
  /** Поток ещё не начался. */
  beforeStart: boolean;
  /** Уроки; после конца доступа все закрыты. */
  access: LessonAccess[];
};

/**
 * Календарь покупки: поток (по записи прохождения, иначе по дате покупки),
 * тариф варианта, открытые уроки и конец доступа.
 */
export function courseTimeline(x: TimelineInput, tz: string, now = new Date()): Timeline {
  const cohorts = x.course.cohorts ?? [];
  const cohort = cohorts.length
    ? (cohorts.find((c) => c.id === x.run?.cohortId) ??
      cohortForPurchase(x.course, new Date(x.boughtAt), tz))
    : null;
  const start = cohort
    ? cohortStart(cohort, tz).toISOString()
    : (x.run?.startedAt ?? now.toISOString());
  const tariff = tariffFor(x.course, x.variantId);
  // Продление вручную (run.until) только удлиняет срок тарифа, не сокращает.
  const byTariff = tariff.accessDays ? Date.parse(start) + tariff.accessDays * 86_400_000 : null;
  const extended = x.run?.until ? Date.parse(x.run.until) : NaN;
  const expiresAt =
    byTariff == null
      ? null
      : new Date(Number.isFinite(extended) ? Math.max(byTariff, extended) : byTariff).toISOString();
  const expired = expiresAt != null && Date.parse(expiresAt) <= now.getTime();
  const access = lessonsAccess(x.course, start, now.getTime()).map((a) =>
    expired ? { ...a, open: false } : a,
  );
  return {
    start,
    cohort,
    tariff,
    expiresAt,
    expired,
    beforeStart: Date.parse(start) > now.getTime(),
    access,
  };
}
