import type { HomeworkStatus } from "./homework";

/**
 * Воронка курса «Где отваливаются» (ниша «Онлайн-школа»): по урокам — сколько
 * учеников открыли урок, сдали ДЗ, прошли урок; в конце — сколько прошли курс.
 * Чистый модуль: строки по ученикам собирает funnel.server.ts, здесь счёт и
 * выбор учеников по шагу.
 */
export type FunnelKind = "opened" | "homework" | "quiz" | "done" | "finished";

/** Один ученик: факты по урокам в порядке курса. */
export type FunnelRow = {
  itemId: string;
  /** Урок открыт ученику (прохождение начато и урок открыт календарём/ДЗ). */
  opened: boolean[];
  /** Статус сдачи ДЗ по уроку; null — не сдавал или у урока нет задания. */
  hw: Array<HomeworkStatus | null>;
  /** Тест урока пройден; false — не проходил или у урока нет теста. */
  quiz: boolean[];
  /** Урок отмечен пройденным (принятое ДЗ, пройденный тест или отметка ученика). */
  done: boolean[];
  /** Курс пройден (условие сертификата). */
  finished: boolean;
};

export type FunnelLesson = {
  no: number;
  title: string;
  hasHomework: boolean;
  hasQuiz: boolean;
  opened: number;
  /** Сдали ДЗ (на проверке, принято или возвращено); 0 у урока без задания. */
  homework: number;
  /** Прошли тест; 0 у урока без теста. */
  quiz: number;
  done: number;
};

export type CourseFunnel = {
  /** Учеников в выборке (все или один поток). */
  students: number;
  lessons: FunnelLesson[];
  finished: number;
};

export function buildFunnel(
  lessons: ReadonlyArray<{ title: string; hasHomework: boolean; hasQuiz: boolean }>,
  rows: readonly FunnelRow[],
): CourseFunnel {
  return {
    students: rows.length,
    lessons: lessons.map((l, i) => ({
      no: i + 1,
      title: l.title,
      hasHomework: l.hasHomework,
      hasQuiz: l.hasQuiz,
      opened: rows.filter((r) => r.opened[i]).length,
      homework: rows.filter((r) => r.hw[i] != null).length,
      quiz: rows.filter((r) => r.quiz[i]).length,
      done: rows.filter((r) => r.done[i]).length,
    })),
    finished: rows.filter((r) => r.finished).length,
  };
}

/** Ученики шага воронки: тот же отбор, что и в счёте. `lessonNo` — с единицы. */
export function pickFunnel(
  rows: readonly FunnelRow[],
  kind: FunnelKind,
  lessonNo = 0,
): FunnelRow[] {
  const i = lessonNo - 1;
  switch (kind) {
    case "opened":
      return rows.filter((r) => r.opened[i]);
    case "homework":
      return rows.filter((r) => r.hw[i] != null);
    case "quiz":
      return rows.filter((r) => r.quiz[i]);
    case "done":
      return rows.filter((r) => r.done[i]);
    case "finished":
      return rows.filter((r) => r.finished);
  }
}
