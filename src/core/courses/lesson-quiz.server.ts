import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingStamped } from "@/core/settings/settings";
import { issueCertificate } from "./certificate.server";
import { readSetting } from "./db.server";
import {
  answersFit,
  gradeQuiz,
  parseQuizResult,
  quizKey,
  withAttempt,
  type QuizGrade,
  type QuizResult,
} from "./lesson-quiz";
import { markLesson, startRun, purchaseTimeline, type CoursePurchase } from "./run.server";

/** Результат теста по одному уроку покупки; записи нет — «попыток не было». */
export async function quizResult(
  ctx: TenantContext,
  orderItemId: string,
  lessonId: string,
): Promise<QuizResult> {
  return parseQuizResult(await readSetting(ctx, quizKey(orderItemId, lessonId)));
}

export type QuizSubmit =
  | { ok: true; grade: QuizGrade; result: QuizResult; certificate: string | null }
  | { ok: false; reason: "noQuiz" | "closed" | "badAnswers" | "stale" | "conflict" };

/**
 * Сдать тест: только открытый урок с тестом этой покупки. Попытка пишется
 * условно по счётчику: ученик присылает `expected` — сколько попыток он видел.
 * Двойная отправка (повтор события, двойной клик) видит уже новый счётчик и
 * получает `stale`, второй попытки не будет. Пройденный тест отмечает урок
 * пройденным (как принятое ДЗ), и в режиме «по заданиям» открывает следующий.
 */
export async function submitQuiz(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  answers: unknown,
  expected: number,
  now = new Date(),
): Promise<QuizSubmit> {
  const run = await startRun(ctx, p, now);
  const access = purchaseTimeline(ctx, { ...p, run }, now).access.find(
    (a) => a.lesson.id === lessonId,
  );
  const quiz = access?.lesson.quiz;
  if (!access || !quiz) return { ok: false, reason: "noQuiz" };
  if (!access.open) return { ok: false, reason: "closed" };
  if (!answersFit(quiz, answers)) return { ok: false, reason: "badAnswers" };
  const grade = gradeQuiz(quiz, answers);
  let saved: QuizResult | null = null;
  let stale = false;
  const r = await updateSettingStamped(ctx, quizKey(p.orderItemId, lessonId), (raw) => {
    const cur = parseQuizResult(raw);
    if (cur.attempts !== expected) {
      stale = true;
      return null;
    }
    saved = withAttempt(cur, grade, now.toISOString());
    return JSON.stringify(saved);
  });
  if (stale) return { ok: false, reason: "stale" };
  if (r !== "written" || !saved) return { ok: false, reason: "conflict" };
  // Отметка после записи попытки: сбой отметки не отнимает у ученика результат.
  let certificate: string | null = null;
  if (grade.passed) {
    const run = await markLesson(ctx, p, lessonId, true, now);
    // Последний урок пройден тестом — курс окончен, как при отметке вручную.
    certificate =
      (await issueCertificate(ctx, { ...p, run }, now).catch(() => null))?.certificate.code ?? null;
  }
  return { ok: true, grade, result: saved, certificate };
}
