import type { AdminT } from "@/app/i18n/admin";
import {
  QUIZ_OPTION_MAX,
  QUIZ_OPTIONS_MAX,
  QUIZ_OPTIONS_MIN,
  QUIZ_PASS_DEFAULT,
  QUIZ_QUESTIONS_MAX,
  QUIZ_TEXT_MAX,
  type LessonQuiz,
  type QuizQuestion,
} from "@/core/courses/lesson-quiz";

/**
 * Тест к уроку в карточке курса: вопросы, варианты с отметкой «верный» (один
 * или несколько), порог прохождения. Ученик верных ответов не видит.
 */
const blankQuestion = (): QuizQuestion => ({ text: "", options: ["", ""], correct: [0] });

export function LessonQuizEditor({
  lessonId,
  quiz,
  onChange,
  t,
}: {
  lessonId: string;
  quiz: LessonQuiz | undefined;
  onChange: (q: LessonQuiz | undefined) => void;
  t: AdminT;
}) {
  if (!quiz)
    return (
      <button
        type="button"
        id={`lesson-quiz-add-${lessonId}`}
        className="btn-secondary mb-2 text-xs"
        onClick={() => onChange({ pass: QUIZ_PASS_DEFAULT, questions: [blankQuestion()] })}
      >
        {t("school.quizAdd")}
      </button>
    );
  const setQuestion = (i: number, f: (q: QuizQuestion) => QuizQuestion) =>
    onChange({ ...quiz, questions: quiz.questions.map((q, k) => (k === i ? f(q) : q)) });
  return (
    <section className="mb-2 space-y-3 rounded border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">🧪 {t("school.quizTitle")}</h4>
        <label className="flex items-center gap-1 text-xs text-muted">
          {t("school.quizPass")}
          <input
            id={`lesson-quiz-pass-${lessonId}`}
            type="number"
            className="input w-20"
            min={1}
            max={100}
            value={quiz.pass}
            onChange={(e) =>
              onChange({
                ...quiz,
                pass: Math.min(100, Math.max(1, Math.round(Number(e.target.value)) || 1)),
              })
            }
          />
          %
        </label>
        <button
          type="button"
          className="btn-ghost ml-auto text-xs"
          onClick={() => onChange(undefined)}
        >
          {t("school.quizRemove")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("school.quizHint")}</p>
      {quiz.questions.map((q, qi) => (
        <div key={qi} className="space-y-2 rounded bg-surface-2 p-2">
          <div className="flex items-start gap-2">
            <span className="pt-2 text-sm tabular-nums">{qi + 1}.</span>
            <textarea
              id={`lesson-quiz-q-${lessonId}-${qi}`}
              className="input min-h-14 min-w-0 flex-1"
              placeholder={t("school.quizQuestion")}
              maxLength={QUIZ_TEXT_MAX}
              value={q.text}
              onChange={(e) => setQuestion(qi, (x) => ({ ...x, text: e.target.value }))}
            />
            <button
              type="button"
              className="btn-ghost"
              aria-label={t("school.quizRemoveQuestion")}
              disabled={quiz.questions.length === 1}
              onClick={() =>
                onChange({ ...quiz, questions: quiz.questions.filter((_, k) => k !== qi) })
              }
            >
              ✕
            </button>
          </div>
          {q.options.map((o, oi) => (
            <div key={oi} className="flex items-center gap-2 pl-6">
              <input
                type="checkbox"
                aria-label={t("school.quizCorrect")}
                title={t("school.quizCorrect")}
                checked={q.correct.includes(oi)}
                onChange={(e) =>
                  setQuestion(qi, (x) => ({
                    ...x,
                    correct: e.target.checked
                      ? [...x.correct, oi].sort((a, b) => a - b)
                      : x.correct.filter((n) => n !== oi),
                  }))
                }
              />
              <input
                id={`lesson-quiz-o-${lessonId}-${qi}-${oi}`}
                className="input min-w-0 flex-1"
                placeholder={t("school.quizOption", { n: oi + 1 })}
                maxLength={QUIZ_OPTION_MAX}
                value={o}
                onChange={(e) =>
                  setQuestion(qi, (x) => ({
                    ...x,
                    options: x.options.map((s, k) => (k === oi ? e.target.value : s)),
                  }))
                }
              />
              <button
                type="button"
                className="btn-ghost"
                aria-label={t("school.quizRemoveOption")}
                disabled={q.options.length <= QUIZ_OPTIONS_MIN}
                onClick={() =>
                  setQuestion(qi, (x) => ({
                    ...x,
                    options: x.options.filter((_, k) => k !== oi),
                    // Индексы верных после удалённого сдвигаются.
                    correct: x.correct.filter((n) => n !== oi).map((n) => (n > oi ? n - 1 : n)),
                  }))
                }
              >
                ✕
              </button>
            </div>
          ))}
          {q.options.length < QUIZ_OPTIONS_MAX && (
            <button
              type="button"
              className="btn-ghost ml-6 text-xs"
              onClick={() => setQuestion(qi, (x) => ({ ...x, options: [...x.options, ""] }))}
            >
              {t("school.quizAddOption")}
            </button>
          )}
        </div>
      ))}
      {quiz.questions.length < QUIZ_QUESTIONS_MAX && (
        <button
          type="button"
          id={`lesson-quiz-addq-${lessonId}`}
          className="btn-secondary text-xs"
          onClick={() => onChange({ ...quiz, questions: [...quiz.questions, blankQuestion()] })}
        >
          {t("school.quizAddQuestion")}
        </button>
      )}
    </section>
  );
}
