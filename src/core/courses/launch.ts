import { localToInstant } from "./cohort";
import type { Live } from "./live";
import { LIVE_RUNNING_MS } from "./live-view";

/**
 * Чеклист запуска онлайн-школы — порядок настройки из docs/COURSES-NICHE.md
 * («Прототип для школы»), которым продавец проходит путь от пустой школы до
 * первой покупки. Чистая часть: данные собирает app/admin/school-launch.server.
 */
export type LaunchCourse = {
  name: string;
  lessons: number;
  channel: boolean;
  /** Эфиры потоков без ссылки, которые ещё не закончились; нет поля — 0. */
  liveNoLink?: number;
};

export type LaunchInput = {
  /** settings.slug: короткий адрес витрины; null — не задан. */
  slug: string | null;
  courses: LaunchCourse[];
  /** Сколько учеников у всех курсов (выданные заказы): есть — тестовая покупка прошла. */
  students: number;
};

export const LAUNCH_STEP_KEYS = ["slug", "course", "lessons", "channel", "purchase"] as const;
export type LaunchStepKey = (typeof LAUNCH_STEP_KEYS)[number];
export type LaunchStep = { key: LaunchStepKey; done: boolean };

export function launchSteps(i: LaunchInput): LaunchStep[] {
  const done: Record<LaunchStepKey, boolean> = {
    slug: Boolean(i.slug),
    course: i.courses.length > 0,
    lessons: i.courses.some((c) => c.lessons > 0),
    channel: i.courses.some((c) => c.channel),
    purchase: i.students > 0,
  };
  return LAUNCH_STEP_KEYS.map((key) => ({ key, done: done[key] }));
}

/** Чеклист нужен, пока не пройдены все шаги. */
export function launchDone(steps: LaunchStep[]): boolean {
  return steps.every((s) => s.done);
}

/** Подсказка вне шагов: показывается, даже когда все шаги пройдены. */
export type LaunchHint = { key: "liveNoLink"; n: number };

/** Эфиры назначены, а ссылки нет: ученик увидит эфир в расписании, но войти ему некуда. */
export function launchHints(i: LaunchInput): LaunchHint[] {
  const n = i.courses.reduce((sum, c) => sum + (c.liveNoLink ?? 0), 0);
  return n > 0 ? [{ key: "liveNoLink", n }] : [];
}

/** Эфиры без ссылки, которые ещё не закончились (core/courses/live-view: идёт 3 часа от начала). */
export function liveNoLinkCount(
  cohorts: ReadonlyArray<{ lives?: Live[] }>,
  tz: string,
  now: Date,
): number {
  let n = 0;
  for (const k of cohorts)
    for (const l of k.lives ?? [])
      if (!l.link && localToInstant(l.at, tz).getTime() + LIVE_RUNNING_MS > now.getTime()) n++;
  return n;
}
