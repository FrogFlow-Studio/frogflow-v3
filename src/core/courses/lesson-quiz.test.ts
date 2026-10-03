import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, courseProblem, parseCourse, type Course } from "./course";
import {
  answersFit,
  gradeQuiz,
  parseQuiz,
  parseQuizResult,
  publicQuiz,
  quizKey,
  quizProblem,
  withAttempt,
  type LessonQuiz,
} from "./lesson-quiz";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));

const { submitQuiz, quizResult } = await import("./lesson-quiz.server");
const { coursePurchase, parseRun, runKey } = await import("./run.server");
const { courseView, setLessonDone } = await import("@/app/storefront/course.server");

/** Тест к уроку (А25): подсчёт, порог, гонка двойной отправки, ответы не уходят в браузер. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-01T10:00:00Z");

const quiz: LessonQuiz = {
  pass: 70,
  questions: [
    { text: "Столица?", options: ["Астана", "Алматы", "Шымкент"], correct: [0] },
    {
      text: "Основные цвета?",
      options: ["Красный", "Зелёный", "Синий", "Жёлтый"],
      correct: [0, 2, 3],
    },
    { text: "2+2?", options: ["3", "4"], correct: [1] },
  ],
};
const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    { id: id(1), title: "Урок с тестом", text: "т", files: [], link: null, quiz },
    { id: id(2), title: "Простой урок", text: "т", files: [], link: null },
  ],
};
const GOOD = [[0], [0, 2, 3], [1]];
const BAD = [[1], [0], [0]];

function shop(c: Course = course) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Курс" }];
  db.tables.orders = [
    { id: 5, status: "delivered", platform: "telegram", telegram_id: 777, display_name: "Мария" },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(c) }];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: {} },
    db,
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}
const purchase = async (ctx: TenantContext) => (await coursePurchase(ctx, ITEM))!;
const rows = (db: ReturnType<typeof fakeDb>) =>
  db.tables.app_settings as Array<{ key: string; value: string }>;

describe("разбор и проверка теста", () => {
  it("битые вопросы пропускаются, порог по умолчанию 70, не больше 10 вопросов", () => {
    const q = parseQuiz({
      pass: 500,
      questions: [
        { text: "", options: ["а", "б"], correct: [0] },
        { text: "один вариант", options: ["а"], correct: [0] },
        { text: "нет верного", options: ["а", "б"], correct: [] },
        { text: "верный вне границ", options: ["а", "б"], correct: [5] },
        { text: "хороший", options: ["а", "б"], correct: [1, 1, 0] },
        ...Array.from({ length: 20 }, (_, i) => ({
          text: `в${i}`,
          options: ["а", "б"],
          correct: [0],
        })),
      ],
    });
    expect(q?.pass).toBe(70);
    expect(q?.questions).toHaveLength(10);
    expect(q?.questions[0]).toEqual({ text: "хороший", options: ["а", "б"], correct: [0, 1] });
    expect(parseQuiz({ questions: [] })).toBeNull();
    expect(parseQuiz(null)).toBeNull();
  });

  it("запись курса с тестом читается, при сохранении плохой вопрос назван по номеру", () => {
    const c = parseCourse(JSON.stringify(course));
    expect(c.lessons[0]!.quiz).toEqual(quiz);
    expect(courseProblem(T, c)).toBeNull();
    const bad = { ...c, lessons: [{ ...c.lessons[0]!, quiz: { ...quiz, pass: 0 } }] };
    expect(courseProblem(T, bad)).toEqual({ kind: "badQuiz", lesson: 1, question: 1 });
    const noCorrect: Course = {
      ...c,
      lessons: [
        {
          ...c.lessons[0]!,
          quiz: {
            pass: 70,
            questions: [quiz.questions[0]!, { text: "?", options: ["а", "б"], correct: [] }],
          },
        },
      ],
    };
    expect(quizProblem(noCorrect.lessons[0]!.quiz!)).toBe(2);
    expect(courseProblem(T, noCorrect)).toEqual({ kind: "badQuiz", lesson: 1, question: 2 });
  });

  it("подсчёт: вопрос засчитан, только если выбраны ровно верные; порог включительно", () => {
    expect(gradeQuiz(quiz, GOOD)).toMatchObject({ score: 3, total: 3, percent: 100, passed: true });
    expect(gradeQuiz(quiz, BAD)).toMatchObject({ score: 0, passed: false });
    // Верные 0 и 2 выбраны, 3 забыт — вопрос 2 не засчитан: 2 из 3 = 67% < 70.
    expect(gradeQuiz(quiz, [[0], [0, 2], [1]])).toMatchObject({
      score: 2,
      percent: 67,
      passed: false,
    });
    // Лишний вариант тоже ошибка.
    expect(gradeQuiz(quiz, [[0], [0, 1, 2, 3], [1]]).score).toBe(2);
    // Порог 67% — 2 из 3 проходит.
    expect(gradeQuiz({ ...quiz, pass: 67 }, [[0], [0, 2], [1]]).passed).toBe(true);
    expect(
      gradeQuiz(quiz, [
        [0, 0],
        [3, 2, 0],
        [1, 1],
      ]),
    ).toMatchObject({ score: 3 });
  });

  it("форма ответов: столько списков, сколько вопросов, индексы в пределах", () => {
    expect(answersFit(quiz, GOOD)).toBe(true);
    expect(answersFit(quiz, [[0], [0]])).toBe(false);
    expect(answersFit(quiz, [[0], [0], [2]])).toBe(false);
    expect(answersFit(quiz, [[0], [0], [-1]])).toBe(false);
    expect(answersFit(quiz, [[0], [0], [0.5]])).toBe(false);
    expect(answersFit(quiz, "x")).toBe(false);
  });

  it("публичный вид без верных ответов", () => {
    const pub = publicQuiz(quiz);
    expect(JSON.stringify(pub)).not.toContain("correct");
    expect(pub.questions.map((x) => x.multi)).toEqual([false, true, false]);
  });

  it("запись результата: «пройден» и лучший не падают, журнал короткий, битая — пустая", () => {
    let r = parseQuizResult(null);
    r = withAttempt(r, gradeQuiz(quiz, GOOD), "2026-10-01T00:00:00Z");
    r = withAttempt(r, gradeQuiz(quiz, BAD), "2026-10-02T00:00:00Z");
    expect(r).toMatchObject({ attempts: 2, passed: true, best: 100 });
    for (let i = 0; i < 20; i++) r = withAttempt(r, gradeQuiz(quiz, BAD), "2026-10-03T00:00:00Z");
    expect(r.log).toHaveLength(10);
    expect(parseQuizResult(JSON.stringify(r))).toEqual(r);
    expect(parseQuizResult("{")).toEqual({ attempts: 0, passed: false, best: 0, log: [] });
  });
});

describe("сдача теста на покупке", () => {
  it("провал считает попытку, пройденный тест отмечает урок пройденным", async () => {
    const { ctx, db } = shop();
    const fail = await submitQuiz(ctx, await purchase(ctx), id(1), BAD, 0, NOW);
    expect(fail).toMatchObject({
      ok: true,
      grade: { passed: false, score: 0 },
      result: { attempts: 1 },
    });
    expect(parseRun(rows(db).find((r) => r.key === runKey(ITEM))?.value)?.done).toEqual([]);
    const ok = await submitQuiz(ctx, await purchase(ctx), id(1), GOOD, 1, NOW);
    expect(ok).toMatchObject({
      ok: true,
      grade: { passed: true },
      result: { attempts: 2, passed: true, best: 100 },
    });
    expect(parseRun(rows(db).find((r) => r.key === runKey(ITEM))?.value)?.done).toEqual([id(1)]);
    expect(await quizResult(ctx, ITEM, id(1))).toMatchObject({ attempts: 2, passed: true });
  });

  it("гонка: одна и та же сдача дважды — одна попытка, вторая «устарела»", async () => {
    const { ctx, db } = shop();
    const p = await purchase(ctx);
    const [a, b] = await Promise.all([
      submitQuiz(ctx, p, id(1), BAD, 0, NOW),
      submitQuiz(ctx, p, id(1), BAD, 0, NOW),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, reason: "stale" });
    const rec = rows(db).filter((r) => r.key === quizKey(ITEM, id(1)));
    expect(rec).toHaveLength(1);
    expect(parseQuizResult(rec[0]!.value).attempts).toBe(1);
  });

  it("устаревший счётчик не пишет; закрытый, чужой и пустой ответ — отказ", async () => {
    const { ctx } = shop();
    await submitQuiz(ctx, await purchase(ctx), id(1), BAD, 0, NOW);
    expect(await submitQuiz(ctx, await purchase(ctx), id(1), GOOD, 0, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect((await quizResult(ctx, ITEM, id(1))).attempts).toBe(1);
    expect(await submitQuiz(ctx, await purchase(ctx), id(2), GOOD, 0, NOW)).toEqual({
      ok: false,
      reason: "noQuiz",
    });
    expect(await submitQuiz(ctx, await purchase(ctx), id(9), GOOD, 0, NOW)).toEqual({
      ok: false,
      reason: "noQuiz",
    });
    expect(await submitQuiz(ctx, await purchase(ctx), id(1), [[0]], 1, NOW)).toEqual({
      ok: false,
      reason: "badAnswers",
    });
    const drip: Course = {
      ...course,
      schedule: { mode: "drip", everyDays: 5 },
      lessons: [course.lessons[1]!, course.lessons[0]!],
    };
    const { ctx: c2 } = shop(drip);
    expect(await submitQuiz(c2, await purchase(c2), id(1), GOOD, 0, NOW)).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("после «пройден» плохая попытка его не снимает", async () => {
    const { ctx } = shop();
    await submitQuiz(ctx, await purchase(ctx), id(1), GOOD, 0, NOW);
    await submitQuiz(ctx, await purchase(ctx), id(1), BAD, 1, NOW);
    expect(await quizResult(ctx, ITEM, id(1))).toMatchObject({
      attempts: 2,
      passed: true,
      best: 100,
    });
  });
});

describe("тест на странице курса", () => {
  it("верные ответы в браузер не уходят, результат виден; вручную урок с тестом не отметить", async () => {
    const { ctx } = shop();
    const sign = async (path: string) => path;
    let v = await courseView(ctx, await purchase(ctx), sign, NOW);
    expect(JSON.stringify(v)).not.toContain('"correct"');
    expect(v.lessons[0]!.quiz).toMatchObject({ pass: 70, attempts: 0, passed: false, last: null });
    expect(v.lessons[1]!.quiz).toBeNull();
    // Ручная отметка урока с тестом — тишина.
    expect((await setLessonDone(ctx, await purchase(ctx), id(1), true, NOW)).done).toEqual([]);
    await submitQuiz(ctx, await purchase(ctx), id(1), BAD, 0, NOW);
    v = await courseView(ctx, await purchase(ctx), sign, NOW);
    expect(v.lessons[0]!.quiz).toMatchObject({
      attempts: 1,
      passed: false,
      last: { score: 0, total: 3 },
    });
    await submitQuiz(ctx, await purchase(ctx), id(1), GOOD, 1, NOW);
    v = await courseView(ctx, await purchase(ctx), sign, NOW);
    expect(v.lessons[0]).toMatchObject({ done: true, quiz: { passed: true, best: 100 } });
    // Снять отметку вручную тоже нельзя.
    expect((await setLessonDone(ctx, await purchase(ctx), id(1), false, NOW)).done).toEqual([
      id(1),
    ]);
  });
});
