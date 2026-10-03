import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { dropCourse, getCourse, saveCourse } from "./course.server";
import {
  courseKey,
  courseProblem,
  LESSONS_MAX,
  lessonOpensAfterDays,
  parseCourse,
  parseLessonList,
  type Course,
  type Lesson,
} from "./course";

const T = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const lesson = (n: number, patch: Partial<Lesson> = {}): Lesson => ({
  id: id(n),
  title: `Урок ${n}`,
  text: "Текст урока",
  files: [],
  link: null,
  ...patch,
});
const course = (lessons: Lesson[], schedule: Course["schedule"] = { mode: "all" }): Course => ({
  schedule,
  lessons,
});

describe("курс — разбор записи", () => {
  it("пустое и битое значение — пустой курс с открытием всех уроков", () => {
    for (const raw of [null, "", "{", "[1]", '"x"'])
      expect(parseCourse(raw)).toEqual({ schedule: { mode: "all" }, lessons: [] });
  });

  it("битые уроки, повторы id, чужие схемы ссылок пропускаются, порядок сохраняется", () => {
    const raw = JSON.stringify({
      schedule: { mode: "drip", everyDays: 3 },
      lessons: [
        lesson(1, { link: "https://youtu.be/x" }),
        { id: "не-uuid", title: "x" },
        lesson(1, { title: "повтор" }),
        lesson(2, { title: "", text: "без названия" }),
        lesson(3, { link: "javascript:alert(1)", files: [{ path: `${T}/a.pdf`, name: "" }] }),
      ],
    });
    const c = parseCourse(raw);
    expect(c.schedule).toEqual({ mode: "drip", everyDays: 3 });
    expect(c.lessons.map((l) => l.id)).toEqual([id(1), id(3)]);
    expect(c.lessons[0]!.link).toBe("https://youtu.be/x");
    expect(c.lessons[1]!.link).toBeNull();
    expect(c.lessons[1]!.files).toEqual([{ path: `${T}/a.pdf`, name: null }]);
  });

  it("расписание вне 1–60 дней — все уроки сразу", () => {
    for (const everyDays of [0, 61, -1, "x"])
      expect(
        parseCourse(JSON.stringify({ schedule: { mode: "drip", everyDays } })).schedule,
      ).toEqual({ mode: "all" });
  });
});

describe("курс — проверка перед записью", () => {
  it("нормальный курс проходит", () => {
    const c = course([lesson(1), lesson(2, { files: [{ path: `${T}/f.pdf`, name: "f.pdf" }] })]);
    expect(courseProblem(T, c)).toBeNull();
  });

  it("файл чужого клиента или небезопасный ключ не проходит", () => {
    for (const path of [`${OTHER}/f.pdf`, `${T}/../${OTHER}/f.pdf`, `${T}/%2e%2e/x`])
      expect(
        courseProblem(T, course([lesson(1), lesson(2, { files: [{ path, name: null }] })])),
      ).toEqual({ kind: "foreignFile", lesson: 2 });
  });

  it("ссылка только https", () => {
    expect(courseProblem(T, course([lesson(1, { link: "http://x.kz" })]))).toEqual({
      kind: "badLink",
      lesson: 1,
    });
  });

  it("пустой урок, урок без названия, повтор id, лишние файлы", () => {
    expect(courseProblem(T, course([lesson(1, { text: " " })]))).toEqual({
      kind: "empty",
      lesson: 1,
    });
    expect(courseProblem(T, course([lesson(1, { title: " " })]))).toEqual({
      kind: "noTitle",
      lesson: 1,
    });
    expect(courseProblem(T, course([lesson(1), lesson(1)]))).toEqual({
      kind: "duplicateId",
      lesson: 2,
    });
    const files = Array.from({ length: 11 }, (_, i) => ({ path: `${T}/${i}.pdf`, name: null }));
    expect(courseProblem(T, course([lesson(1, { files })]))).toEqual({
      kind: "tooManyFiles",
      lesson: 1,
    });
  });

  it("не больше 100 уроков, расписание 1–60 дней", () => {
    const many = Array.from({ length: 101 }, (_, i) => lesson(i + 1));
    expect(courseProblem(T, course(many))).toEqual({ kind: "tooMany" });
    expect(courseProblem(T, course([lesson(1)], { mode: "drip", everyDays: 0 }))).toEqual({
      kind: "badSchedule",
    });
    expect(courseProblem(T, course([lesson(1)], { mode: "drip", everyDays: 7 }))).toBeNull();
  });

  it("по расписанию первый урок открыт сразу, дальше шагом в N дней", () => {
    const drip = { mode: "drip", everyDays: 3 } as const;
    expect([0, 1, 2].map((i) => lessonOpensAfterDays(drip, i))).toEqual([0, 3, 6]);
    expect(lessonOpensAfterDays({ mode: "all" }, 5)).toBe(0);
  });
});

function ctxWith(products: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.products = products;
  db.tables.app_settings = [];
  const ctx = { tenant: { id: T, modules: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("курс — запись в настройки клиента", () => {
  it("сохраняет под ключом товара и читает обратно", async () => {
    const { ctx, db } = ctxWith([{ id: P, fulfillment_kind: "digital" }]);
    const c = course([lesson(1, { title: "  Введение  " })], { mode: "drip", everyDays: 2 });
    await saveCourse(ctx, P, c);
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual([courseKey(P)]);
    const back = await getCourse(ctx, P);
    expect(back.schedule).toEqual({ mode: "drip", everyDays: 2 });
    expect(back.lessons[0]!.title).toBe("Введение");
  });

  it("чужой или несуществующий товар и физический товар — отказ", async () => {
    const { ctx } = ctxWith([{ id: P, fulfillment_kind: "physical" }]);
    await expect(saveCourse(ctx, P, course([lesson(1)]))).rejects.toMatchObject({
      key: "err.course.physical",
    });
    await expect(saveCourse(ctx, id(9), course([lesson(1)]))).rejects.toMatchObject({
      key: "err.course.noProduct",
    });
  });

  it("файл чужого клиента не записывается", async () => {
    const { ctx, db } = ctxWith([{ id: P, fulfillment_kind: "digital" }]);
    const bad = course([lesson(1, { files: [{ path: `${OTHER}/x.pdf`, name: null }] })]);
    await expect(saveCourse(ctx, P, bad)).rejects.toMatchObject({ key: "err.course.badLesson" });
    expect(db.tables.app_settings).toEqual([]);
  });

  it("удаление товара убирает запись и отдаёт файлы уроков на удаление", async () => {
    const { ctx, db } = ctxWith([{ id: P, fulfillment_kind: "digital" }]);
    const f = { path: `${T}/lesson.pdf`, name: "lesson.pdf" };
    await saveCourse(ctx, P, course([lesson(1, { files: [f] })]));
    expect(await dropCourse(ctx, P)).toEqual([f.path]);
    expect(db.tables.app_settings).toEqual([]);
    expect(await dropCourse(ctx, P)).toEqual([]);
  });
});

describe("уроки списком (А34)", () => {
  it("«Название — ссылка», без ссылки и разные разделители; пустые строки не считаются", () => {
    const r = parseLessonList(
      [
        "Введение — https://youtu.be/abc",
        "",
        "   ",
        "Кисти - и краски – https://youtu.be/def",
        "Только название",
        "Урок | https://vimeo.com/1",
        "Урок 5\thttps://rutube.ru/x",
      ].join("\r\n"),
      0,
    );
    expect(r.lessons).toEqual([
      { title: "Введение", link: "https://youtu.be/abc" },
      { title: "Кисти - и краски", link: "https://youtu.be/def" },
      { title: "Только название", link: null },
      { title: "Урок", link: "https://vimeo.com/1" },
      { title: "Урок 5", link: "https://rutube.ru/x" },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.overLimit).toBe(0);
  });

  it("не https, одна голая ссылка и слишком длинное название — в пропущенных, с номером строки", () => {
    const r = parseLessonList(
      [
        "Ок — https://youtu.be/ok",
        "Плохая — http://example.com/a",
        "Файл — ftp://example.com/a",
        "https://youtu.be/bare",
        `${"я".repeat(201)} — https://youtu.be/x`,
        "Рядом — www.example.com/a",
        "Название с дефисом - не ссылка",
      ].join("\n"),
      0,
    );
    expect(r.lessons.map((l) => l.title)).toEqual(["Ок", "Название с дефисом - не ссылка"]);
    expect(r.leftover.split("\n")).toHaveLength(5);
    expect(r.leftover.split("\n")[0]).toBe("Плохая — http://example.com/a");
    expect(r.skipped).toEqual([
      { line: 2, reason: "notHttps" },
      { line: 3, reason: "notHttps" },
      { line: 4, reason: "noTitle" },
      { line: 5, reason: "titleTooLong" },
      { line: 6, reason: "notHttps" },
    ]);
  });

  it("лимит уроков: берём свободные места, остальное считаем, а не теряем молча", () => {
    const text = Array.from({ length: 5 }, (_, i) => `Урок ${i + 1}`).join("\n");
    const r = parseLessonList(text, LESSONS_MAX - 3);
    expect(r.lessons).toHaveLength(3);
    expect(r.overLimit).toBe(2);
    expect(r.leftover).toBe("Урок 4\nУрок 5");
    const full = parseLessonList(text, LESSONS_MAX);
    expect(full.lessons).toHaveLength(0);
    expect(full.overLimit).toBe(5);
    // Испорченные строки в лимит не входят.
    expect(parseLessonList("Плохая — http://a.b\nХорошая", LESSONS_MAX - 1)).toMatchObject({
      lessons: [{ title: "Хорошая" }],
      overLimit: 0,
    });
  });
});
