/**
 * Тест к уроку (ниша «Онлайн-школа»): до 10 вопросов с вариантами (один или
 * несколько верных), порог прохождения в процентах. Правильные ответы лежат
 * только в курсе (`Lesson.quiz`) и в браузер и бот не уходят: ученик получает
 * `publicQuiz` без них и присылает выбранное, оценивает сервер.
 *
 * Результат одной покупки по уроку — запись `quiz_<позиция>_<урок>` в
 * `app_settings`: число попыток, лучший результат, «пройден» и последние
 * попытки. Пишется условно по счётчику попыток (core/courses/lesson-quiz.server).
 * Чистый модуль: его читает и редактор в браузере.
 */
export const QUIZ_KEY_PREFIX = "quiz_";
export const QUIZ_QUESTIONS_MAX = 10;
export const QUIZ_OPTIONS_MIN = 2;
export const QUIZ_OPTIONS_MAX = 6;
export const QUIZ_TEXT_MAX = 300;
export const QUIZ_OPTION_MAX = 150;
export const QUIZ_PASS_DEFAULT = 70;
/** Сколько последних попыток хранить в записи (она читается при каждом открытии курса). */
export const QUIZ_LOG_MAX = 10;

export type QuizQuestion = {
  text: string;
  options: string[];
  /** Индексы верных вариантов; хотя бы один. */
  correct: number[];
};
export type LessonQuiz = {
  questions: QuizQuestion[];
  /** Порог: сколько процентов вопросов нужно ответить верно (1–100). */
  pass: number;
};

export const quizKey = (orderItemId: string, lessonId: string) =>
  `${QUIZ_KEY_PREFIX}${orderItemId}_${lessonId}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Тест из записи курса. Битый вопрос (пустой текст, меньше двух вариантов,
 * нет верного) пропускается; нет ни одного вопроса — теста нет.
 */
export function parseQuiz(v: unknown): LessonQuiz | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { questions?: unknown; pass?: unknown };
  const questions: QuizQuestion[] = [];
  for (const q of Array.isArray(o.questions) ? o.questions : []) {
    const x = (q ?? {}) as Record<string, unknown>;
    const text = str(x.text, QUIZ_TEXT_MAX);
    const options = (Array.isArray(x.options) ? x.options : [])
      .map((s) => str(s, QUIZ_OPTION_MAX))
      .slice(0, QUIZ_OPTIONS_MAX);
    const correct = [
      ...new Set(
        (Array.isArray(x.correct) ? x.correct : []).filter(
          (i): i is number => Number.isInteger(i) && i >= 0 && i < options.length,
        ),
      ),
    ].sort((a, b) => a - b);
    if (!text || options.length < QUIZ_OPTIONS_MIN || options.some((s) => !s) || !correct.length)
      continue;
    questions.push({ text, options, correct });
    if (questions.length >= QUIZ_QUESTIONS_MAX) break;
  }
  if (!questions.length) return null;
  const pass = Math.round(Number(o.pass));
  return { questions, pass: pass >= 1 && pass <= 100 ? pass : QUIZ_PASS_DEFAULT };
}

/** Номер (с единицы) первого плохого вопроса при сохранении курса; null — всё верно. */
export function quizProblem(q: LessonQuiz): number | null {
  if (q.questions.length < 1 || q.questions.length > QUIZ_QUESTIONS_MAX) return 1;
  if (!Number.isInteger(q.pass) || q.pass < 1 || q.pass > 100) return 1;
  for (const [i, x] of q.questions.entries()) {
    const bad =
      !x.text.trim() ||
      x.text.length > QUIZ_TEXT_MAX ||
      x.options.length < QUIZ_OPTIONS_MIN ||
      x.options.length > QUIZ_OPTIONS_MAX ||
      x.options.some((s) => !s.trim() || s.length > QUIZ_OPTION_MAX) ||
      x.correct.length < 1 ||
      new Set(x.correct).size !== x.correct.length ||
      x.correct.some((c) => !Number.isInteger(c) || c < 0 || c >= x.options.length);
    if (bad) return i + 1;
  }
  return null;
}

/** Вопросы для ученика: без верных ответов. */
export type PublicQuiz = {
  pass: number;
  /** multi — верных несколько (в браузере и в боте это флажки, а не выбор одного). */
  questions: Array<{ text: string; options: string[]; multi: boolean }>;
};

export function publicQuiz(q: LessonQuiz): PublicQuiz {
  return {
    pass: q.pass,
    questions: q.questions.map((x) => ({
      text: x.text,
      options: [...x.options],
      multi: x.correct.length > 1,
    })),
  };
}

/** Ответы ученика: по вопросу — выбранные индексы. */
export type QuizAnswers = number[][];

/** Форма ответов: столько списков, сколько вопросов, индексы целые и в пределах вариантов. */
export function answersFit(q: LessonQuiz, a: unknown): a is QuizAnswers {
  return (
    Array.isArray(a) &&
    a.length === q.questions.length &&
    a.every(
      (sel, i) =>
        Array.isArray(sel) &&
        sel.length <= q.questions[i]!.options.length &&
        sel.every((n) => Number.isInteger(n) && n >= 0 && n < q.questions[i]!.options.length),
    )
  );
}

export type QuizGrade = { score: number; total: number; percent: number; passed: boolean };

/** Вопрос засчитан, только если выбраны ровно верные варианты. */
export function gradeQuiz(q: LessonQuiz, answers: QuizAnswers): QuizGrade {
  const total = q.questions.length;
  const score = q.questions.filter((x, i) => {
    const got = [...new Set(answers[i] ?? [])].sort((a, b) => a - b);
    return got.length === x.correct.length && got.every((n, k) => n === x.correct[k]);
  }).length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percent, passed: total > 0 && percent >= q.pass };
}

export type QuizAttempt = { at: string; score: number; total: number };
export type QuizResult = {
  /** Сколько попыток сделано; по нему записывается следующая (условно). */
  attempts: number;
  passed: boolean;
  /** Лучший результат, процентов. */
  best: number;
  log: QuizAttempt[];
};

/** Запись результата; битая или пустая — «попыток не было». */
export function parseQuizResult(raw: string | null | undefined): QuizResult {
  const none: QuizResult = { attempts: 0, passed: false, best: 0, log: [] };
  if (!raw) return none;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const attempts = Math.round(Number(o.attempts));
    const best = Math.round(Number(o.best));
    const log = (Array.isArray(o.log) ? o.log : []).flatMap((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const score = Math.round(Number(x.score));
      const total = Math.round(Number(x.total));
      return typeof x.at === "string" && score >= 0 && total >= 1
        ? [{ at: x.at.slice(0, 40), score, total }]
        : [];
    });
    return {
      attempts: attempts >= 0 ? attempts : 0,
      passed: o.passed === true,
      best: best >= 0 && best <= 100 ? best : 0,
      log: log.slice(-QUIZ_LOG_MAX),
    };
  } catch {
    return none;
  }
}

/** Результат после попытки: «пройден» не снимается, лучший не падает. */
export function withAttempt(prev: QuizResult, g: QuizGrade, at: string): QuizResult {
  return {
    attempts: prev.attempts + 1,
    passed: prev.passed || g.passed,
    best: Math.max(prev.best, g.percent),
    log: [...prev.log, { at, score: g.score, total: g.total }].slice(-QUIZ_LOG_MAX),
  };
}
