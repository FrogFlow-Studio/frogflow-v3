import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, type Course } from "@/core/courses/course";
import { quizKey } from "@/core/courses/lesson-quiz";
import { runKey } from "@/core/courses/run.server";
import { fakeDb } from "../../../tests/fake-db";
import { STUDENT_COLUMNS, studentsCsv } from "./students-export.server";

/** Выгрузка учеников: строка на покупку, постранично, без обрезки. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V = "bbbbbbbb-0000-4000-8000-000000000001";
const L1 = "11111111-0000-4000-8000-000000000001";
const L2 = "11111111-0000-4000-8000-000000000002";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    { id: L1, title: "Один", text: "", files: [], link: null },
    { id: L2, title: "Два", text: "", files: [], link: null },
  ],
  tariffs: { [V]: { homework: true, channel: true, accessDays: 30 } },
};
const NOW = new Date("2026-10-10T10:00:00Z");

function shop(n: number, c: Course = course) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [{ id: P, name: "Аквагрим" }];
  db.tables.product_variants = [{ id: V, name: "Стандарт" }];
  db.tables.order_items = Array.from({ length: n }, (_, i) => ({
    id: `item-${String(i).padStart(5, "0")}`,
    order_id: i + 1,
    product_id: P,
    product_variant_id: V,
  }));
  db.tables.orders = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    order_no: i + 1,
    display_no: 1000 + i,
    display_name: i === 0 ? "=Аня; Т." : `Ученик ${i}`,
    status: "delivered",
    created_at: "2026-10-01T00:00:00Z",
  }));
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(c) },
    {
      bot_id: T,
      key: runKey("item-00000"),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [L1] }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true } },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return ctx;
}

describe("выгрузка учеников", () => {
  it("тесты: пройдено и число попыток по каждому ученику", async () => {
    const withQuiz: Course = {
      ...course,
      lessons: [
        course.lessons[0]!,
        {
          ...course.lessons[1]!,
          quiz: { pass: 100, questions: [{ text: "2+2?", options: ["3", "4"], correct: [1] }] },
        },
      ],
    };
    const ctx = shop(2, withQuiz);
    const rec = (n: number, attempts: number, passed: boolean) => ({
      bot_id: T,
      key: quizKey(`item-0000${n}`, L2),
      value: JSON.stringify({ attempts, from: 0, passed, best: passed ? 100 : 0, log: [] }),
    });
    (ctx.db as unknown as { tables: { app_settings: unknown[] } }).tables.app_settings.push(
      rec(0, 3, true),
      rec(1, 1, false),
    );
    const { csv } = await studentsCsv(ctx, null, NOW);
    const [head, ...lines] = csv.replace(/^\uFEFF/, "").split("\r\n");
    // Имя «Аня; Т.» содержит «;» — колонки считаем с конца строки.
    const names = head!.split(";");
    const col = (line: string, name: string) =>
      line.split(";").at(names.indexOf(name) - names.length);
    const byName = (n: string) => lines.find((l) => l.includes(n))!;
    expect(col(byName("Аня"), "Тестов пройдено")).toBe("1");
    expect(col(byName("Аня"), "Попыток теста")).toBe("3");
    expect(col(byName("Ученик 1"), "Тестов пройдено")).toBe("0");
    expect(col(byName("Ученик 1"), "Попыток теста")).toBe("1");
  });

  it("колонки, значения и защита от формул", async () => {
    const { csv, count } = await studentsCsv(shop(2), null, NOW);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(count).toBe(2);
    expect(lines[0]).toBe(STUDENT_COLUMNS.join(";"));
    const first = lines.find((l) => l.includes("Аня"))!;
    expect(first).toContain(`"'=Аня; Т."`);
    expect(first.split(";")[0]).toBe("Аквагрим");
    expect(first).toContain("Стандарт");
    expect(first).toContain(";2;2;1;"); // уроков 2, открыто 2, пройден 1
    expect(first).toContain("2026-10-31"); // доступ до: старт + 30 дней
    expect(STUDENT_COLUMNS.slice(10, 15)).toEqual([
      "ДЗ принято",
      "ДЗ ждёт проверки",
      "ДЗ на доработке",
      "Тестов пройдено",
      "Попыток теста",
    ]);
  });

  it("больше тысячи учеников — все на месте (постранично, без обрезки)", async () => {
    const { count, csv } = await studentsCsv(shop(1250), null, NOW);
    expect(count).toBe(1250);
    expect(csv.split("\r\n")).toHaveLength(1251);
  });

  it("фильтр по курсу: чужой id — пусто", async () => {
    const r = await studentsCsv(shop(3), "99999999-0000-4000-8000-000000000000", NOW);
    expect(r.count).toBe(0);
  });
});
