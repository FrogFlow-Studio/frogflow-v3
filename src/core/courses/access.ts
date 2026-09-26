import { lessonOpensAfterDays, type Course, type Lesson } from "./course";

/**
 * Какие уроки открыты покупателю. Отсчёт — от начала прохождения (выдачи
 * курса), а не от оформления заказа: чек могут подтвердить через три дня, и
 * покупатель не должен получить сразу три урока. Модуль без базы.
 */
const DAY_MS = 86_400_000;

export type LessonAccess = {
  lesson: Lesson;
  /** Номер с единицы, как в списке. */
  no: number;
  open: boolean;
  /** Когда откроется (ISO); у открытого — когда открылся. */
  opensAt: string;
};

export function lessonsAccess(course: Course, startedAt: string, now = Date.now()): LessonAccess[] {
  const start = Date.parse(startedAt);
  const base = Number.isFinite(start) ? start : now;
  return course.lessons.map((lesson, i) => {
    const at = base + lessonOpensAfterDays(course.schedule, i) * DAY_MS;
    return { lesson, no: i + 1, open: at <= now, opensAt: new Date(at).toISOString() };
  });
}

/** Ближайшее открытие урока после `now`; null — все уже открыты. */
export function nextOpening(access: readonly LessonAccess[]): LessonAccess | null {
  return access.find((a) => !a.open) ?? null;
}
