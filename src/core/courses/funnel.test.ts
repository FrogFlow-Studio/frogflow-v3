import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { buildFunnel, pickFunnel, type FunnelRow } from "./funnel";
import { courseFunnel, funnelStudents } from "./funnel.server";
import { courseKey, type Course } from "./course";
import { hwKey } from "./homework";
import { quizKey } from "./lesson-quiz";
import { runKey } from "./run.server";

/** Воронка курса (А26): где ученики отваливаются. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OCT = "dddddddd-0000-4000-8000-000000000001";
const NOV = "dddddddd-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-30T10:00:00Z");

const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    { id: id(1), title: "Кисти", text: "т", files: [], link: null, homework: "Круг" },
    {
      id: id(2),
      title: "Цвет",
      text: "т",
      files: [],
      link: null,
      homework: "Смешать",
      quiz: { pass: 100, questions: [{ text: "2+2?", options: ["3", "4"], correct: [1] }] },
    },
    { id: id(3), title: "Итог", text: "т", files: [], link: null },
  ],
  cohorts: [
    { id: OCT, title: "Октябрь", start: "2026-10-01T10:00", enrollUntil: "2026-10-05" },
    { id: NOV, title: "Ноябрь", start: "2026-11-15T10:00", enrollUntil: null },
  ],
};

const hw = (it: number, lesson: string, status: string) => ({
  bot_id: T,
  key: hwKey(item(it), lesson),
  value: JSON.stringify({
    rev: 1,
    orderItemId: item(it),
    lessonId: lesson,
    productId: P,
    course: "К",
    lessonNo: 1,
    lessonTitle: "У",
    student: "С",
    status,
    attempts: [{ at: "2026-10-02T00:00:00Z", text: "ответ", files: [] }],
    feedback: null,
    updatedAt: "2026-10-02T00:00:00Z",
  }),
});
const quizRec = (it: number, passed: boolean) => ({
  bot_id: T,
  key: quizKey(item(it), id(2)),
  value: JSON.stringify({ attempts: 2, from: 0, passed, best: passed ? 100 : 0, log: [] }),
});
const run = (it: number, done: string[]) => ({
  bot_id: T,
  key: runKey(item(it)),
  value: JSON.stringify({ startedAt: "2026-10-01T10:00:00Z", done, cohortId: OCT }),
});

function school(c: Course = course) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const order = (n: number, status = "delivered", at = "2026-10-02T00:00:00Z") => ({
    id: n,
    order_no: n,
    display_no: n,
    display_name: `Ученик ${n}`,
    created_at: at,
    status,
  });
  db.tables.orders = [
    order(1),
    order(2),
    order(3),
    order(4),
    order(5, "awaiting_payment"),
    order(6, "delivered", "2026-11-01T00:00:00Z"),
  ];
  db.tables.order_items = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: item(n),
    order_id: n,
    product_id: P,
    product_variant_id: null,
  }));
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(c) },
    // 1 — прошёл всё: ДЗ приняты, все уроки отмечены.
    run(1, [id(1), id(2), id(3)]),
    hw(1, id(1), "accepted"),
    hw(1, id(2), "accepted"),
    quizRec(1, true),
    // 2 — сдал первое ДЗ, ничего не отмечено.
    run(2, []),
    hw(2, id(1), "submitted"),
    // 3 — второе ДЗ вернули на доработку, первое принято.
    run(3, [id(1)]),
    hw(3, id(1), "accepted"),
    hw(3, id(2), "revise"),
    quizRec(3, false),
    // 4 — купил, но прохождение не начато.
    // 5 — заказ не выдан. 6 — купил в ноябре: свой поток.
    {
      bot_id: T,
      key: runKey(item(6)),
      value: JSON.stringify({ startedAt: "2026-11-01T10:00:00Z", done: [], cohortId: NOV }),
    },
  ];
  const make = (d: typeof db) =>
    ({
      tenant: { id: T, modules: { courses: true } },
      db: d,
      timezone: "Asia/Almaty",
    }) as unknown as TenantContext;
  return { db, ctx: make(db), broken: (t: string[]) => make(withBrokenReads(db, t)) };
}

describe("подсчёт воронки на наборе прохождений", () => {
  const lessons = [
    { title: "А", hasHomework: true, hasQuiz: false },
    { title: "Б", hasHomework: false, hasQuiz: true },
  ];
  const row = (n: number, p: Partial<FunnelRow>): FunnelRow => ({
    itemId: `i${n}`,
    opened: [false, false],
    hw: [null, null],
    quiz: [false, false],
    done: [false, false],
    finished: false,
    ...p,
  });
  const rows = [
    row(1, {
      opened: [true, true],
      hw: ["accepted", null],
      quiz: [false, true],
      done: [true, true],
      finished: true,
    }),
    row(2, { opened: [true, true], hw: ["submitted", null], done: [false, false] }),
    row(3, { opened: [true, false], hw: ["revise", null], done: [false, false] }),
    row(4, {}),
  ];

  it("по урокам: открыли, сдали ДЗ, прошли; в конце — прошли курс", () => {
    expect(buildFunnel(lessons, rows)).toEqual({
      students: 4,
      lessons: [
        {
          no: 1,
          title: "А",
          hasHomework: true,
          hasQuiz: false,
          opened: 3,
          homework: 3,
          quiz: 0,
          done: 1,
        },
        {
          no: 2,
          title: "Б",
          hasHomework: false,
          hasQuiz: true,
          opened: 2,
          homework: 0,
          quiz: 1,
          done: 1,
        },
      ],
      finished: 1,
    });
  });

  it("клик по шагу даёт тех же учеников, что и счёт", () => {
    expect(pickFunnel(rows, "opened", 1).map((r) => r.itemId)).toEqual(["i1", "i2", "i3"]);
    expect(pickFunnel(rows, "homework", 1).map((r) => r.itemId)).toEqual(["i1", "i2", "i3"]);
    expect(pickFunnel(rows, "quiz", 2).map((r) => r.itemId)).toEqual(["i1"]);
    expect(pickFunnel(rows, "done", 2).map((r) => r.itemId)).toEqual(["i1"]);
    expect(pickFunnel(rows, "finished").map((r) => r.itemId)).toEqual(["i1"]);
    expect(pickFunnel([], "opened", 1)).toEqual([]);
  });
});

describe("воронка курса из базы", () => {
  it("весь курс: выданные заказы, не начавший не открыл ни одного урока", async () => {
    const f = await courseFunnel(school().ctx, P, null, NOW);
    expect(f.students).toBe(5);
    expect(f.cohorts.map((c) => c.title)).toEqual(["Октябрь", "Ноябрь"]);
    expect(f.lessons.map((l) => [l.opened, l.homework, l.done])).toEqual([
      [3, 3, 2], // открыли у учеников 1, 2, 3 (4 не начинал, 6 — поток ещё не начался)
      [3, 2, 1], // ДЗ 2: принято у 1, возврат у 3
      [3, 0, 1],
    ]);
    expect(f.finished).toBe(1);
  });

  it("по потоку: октябрьские отдельно от ноябрьских", async () => {
    const s = school();
    const oct = await courseFunnel(s.ctx, P, OCT, NOW);
    expect(oct.students).toBe(4);
    const nov = await courseFunnel(s.ctx, P, NOV, NOW);
    expect(nov.students).toBe(1);
    expect(nov.lessons.every((l) => l.opened === 0 && l.done === 0)).toBe(true);
  });

  it("шаг «прошли тест»: только уроки с тестом, непройденный и чужой тест не считаются", async () => {
    const s = school();
    const f = await courseFunnel(s.ctx, P, null, NOW);
    expect(f.lessons.map((l) => [l.hasQuiz, l.quiz])).toEqual([
      [false, 0],
      [true, 1], // у 1 пройден, у 3 попытки были, но не прошёл
      [false, 0],
    ]);
    const who = await funnelStudents(s.ctx, P, null, "quiz", 2, NOW);
    expect(who.map((w) => w.orderNo)).toEqual([1]);
    expect(who.length).toBe(f.lessons[1]!.quiz);
  });

  it("клик по цифре: список учеников шага, по номеру заказа", async () => {
    const s = school();
    const who = await funnelStudents(s.ctx, P, null, "homework", 1, NOW);
    expect(who.map((w) => [w.orderNo, w.buyer])).toEqual([
      [1, "Ученик 1"],
      [2, "Ученик 2"],
      [3, "Ученик 3"],
    ]);
    const finished = await funnelStudents(s.ctx, P, OCT, "finished", 0, NOW);
    expect(finished.map((w) => w.orderNo)).toEqual([1]);
    // Число в списке совпадает с цифрой воронки.
    const f = await courseFunnel(s.ctx, P, null, NOW);
    expect((await funnelStudents(s.ctx, P, null, "done", 1, NOW)).length).toBe(f.lessons[0]!.done);
  });

  it("режим «по заданиям»: урок 2 открыт только у принявших ДЗ первого", async () => {
    const tasks: Course = { ...course, schedule: { mode: "tasks", unlock: "accepted" } };
    const f = await courseFunnel(school(tasks).ctx, P, null, NOW);
    // Урок 1 открыт у 1,2,3; урок 2 — у 1 и 3 (приняты), урок 3 — у 1 (ДЗ 2 принято).
    expect(f.lessons.map((l) => l.opened)).toEqual([3, 2, 1]);
  });

  it("сбой чтения — ошибка (serverFailure), а не пустая воронка", async () => {
    const s = school();
    for (const t of [["order_items"], ["orders"], ["app_settings"]]) {
      await expect(courseFunnel(s.broken(t), P, null, NOW)).rejects.toMatchObject({
        name: "ServerFailure",
      });
      await expect(funnelStudents(s.broken(t), P, null, "opened", 1, NOW)).rejects.toMatchObject({
        name: "ServerFailure",
      });
    }
    // а исправная база даёт цифры, не нули
    expect((await courseFunnel(s.ctx, P, null, NOW)).students).toBe(5);
  });
});
