import { lessonOpensAfterDays, type Course, type HwUnlock, type Lesson } from "./course";

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
  /** Урок ждёт не даты, а ДЗ предыдущего (режим «по заданиям»). */
  gated?: boolean;
};

/**
 * Прогресс для режима «по заданиям»: статусы сдач по id урока и пройденные
 * уроки. Нет прогресса — открыт только первый урок (закрыто по умолчанию).
 */
export type TaskGate = {
  hw: ReadonlyMap<string, "submitted" | "accepted" | "revise">;
  done: readonly string[];
  /** Уроки с пройденным тестом (А25): урок с тестом закрыт, пока тест не пройден. */
  quiz: ReadonlySet<string>;
  /** Тариф без проверки ДЗ: сдавать некому, урок засчитывается по отметке «пройден». */
  byDone: boolean;
};

/**
 * Пройден ли урок для открытия следующего. Без ДЗ не задерживает; без проверки
 * по тарифу — по отметке «пройден»; иначе принято (или сдано, по настройке).
 * Принятая работа остаётся принятой, а любая сдача — сдачей: возврат на
 * доработку уже открытый урок не закрывает.
 */
export function lessonCleared(lesson: Lesson, unlock: HwUnlock, gate: TaskGate): boolean {
  // Пройденный тест — как принятое задание: нужны и ДЗ (если есть), и тест (если есть).
  if (lesson.quiz && !gate.quiz.has(lesson.id)) return false;
  if (!lesson.homework) return true;
  if (gate.byDone) return gate.done.includes(lesson.id);
  const status = gate.hw.get(lesson.id);
  if (!status) return false;
  return unlock === "submitted" ? true : status === "accepted";
}

export function lessonsAccess(
  course: Course,
  startedAt: string,
  now = Date.now(),
  gate?: TaskGate,
): LessonAccess[] {
  const start = Date.parse(startedAt);
  const base = Number.isFinite(start) ? start : now;
  const { schedule } = course;
  if (schedule.mode === "tasks") {
    let prevOpen = true;
    return course.lessons.map((lesson, i) => {
      const prev = i > 0 ? course.lessons[i - 1]! : null;
      const open =
        base <= now &&
        prevOpen &&
        (!prev || (gate != null && lessonCleared(prev, schedule.unlock, gate)));
      prevOpen = open;
      return { lesson, no: i + 1, open, opensAt: new Date(base).toISOString(), gated: i > 0 };
    });
  }
  return course.lessons.map((lesson, i) => {
    const at = base + lessonOpensAfterDays(schedule, i) * DAY_MS;
    return { lesson, no: i + 1, open: at <= now, opensAt: new Date(at).toISOString() };
  });
}

/**
 * Ближайшее открытие урока после `now`; null — все уже открыты. Урок,
 * который ждёт ДЗ, даты не имеет — ближайшим по дате не считается.
 */
export function nextOpening(access: readonly LessonAccess[]): LessonAccess | null {
  const next = access.find((a) => !a.open);
  return next && !next.gated ? next : null;
}
