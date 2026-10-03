import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { lessonsAccess, nextOpening } from "./access";
import { courseKey, parseCourse, type Course } from "./course";

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}));

const { reviewHomework, submitHomework } = await import("./homework.server");
const { coursePurchase, markLesson, purchaseTimeline } = await import("./run.server");
const { loadRuns } = await import("./runs.server");
const { announceNewLessons } = await import("./announce.server");
const { submitQuiz } = await import("./lesson-quiz.server");

/** Расписание «по заданиям» (А24): следующий урок открывается после ДЗ предыдущего. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const V_NOHW = "bbbbbbbb-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-01T10:00:00Z");

const lessons = [
  { id: id(1), title: "Урок 1", text: "т", files: [], link: null, homework: "Задание 1" },
  { id: id(2), title: "Урок 2", text: "т", files: [], link: null, homework: "Задание 2" },
  { id: id(3), title: "Урок 3", text: "т", files: [], link: null },
  { id: id(4), title: "Урок 4", text: "т", files: [], link: null, homework: "Задание 4" },
];
const course = (unlock: "accepted" | "submitted"): Course => ({
  schedule: { mode: "tasks", unlock },
  lessons,
  tariffs: { [V_NOHW]: { homework: false, channel: true, accessDays: null } },
});

function shop(c: Course, variant: string | null = null) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: ITEM, order_id: 5, product_id: P, product_variant_id: variant, name_snapshot: "Курс" },
  ];
  db.tables.orders = [
    {
      id: 5,
      status: "delivered",
      platform: "telegram",
      telegram_id: 777,
      display_name: "Мария",
      created_at: "2026-09-30T10:00:00Z",
    },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(c) }];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: {} },
    db,
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}
const opens = async (ctx: TenantContext) => {
  const p = (await coursePurchase(ctx, ITEM))!;
  return purchaseTimeline(ctx, p, NOW).access.map((a) => a.open);
};
const submit = async (ctx: TenantContext, lesson: string) =>
  submitHomework(
    ctx,
    (await coursePurchase(ctx, ITEM))!,
    lesson,
    { text: "ответ", files: [] },
    NOW,
  );
const review = async (
  ctx: TenantContext,
  lesson: string,
  rev: number,
  status: "accepted" | "revise",
) => reviewHomework(ctx, ITEM, lesson, { rev, status, text: "комментарий", by: "Анастасия" }, NOW);

describe("урок после ДЗ: чистая логика", () => {
  const START = "2026-10-01T09:00:00.000Z";
  const now = Date.parse(START) + 3_600_000;
  const c = course("accepted");

  it("без прогресса открыт только первый урок, даты у остальных нет", () => {
    const a = lessonsAccess(c, START, now);
    expect(a.map((x) => x.open)).toEqual([true, false, false, false]);
    expect(nextOpening(a)).toBeNull();
  });

  it("до старта потока не открыт и первый; ближайшее открытие — старт", () => {
    const a = lessonsAccess(c, START, Date.parse(START) - 1);
    expect(a.map((x) => x.open)).toEqual([false, false, false, false]);
    expect(nextOpening(a)?.no).toBe(1);
  });

  it("урок без задания следующий не задерживает", () => {
    const gate = {
      hw: new Map([[id(2), "accepted" as const]]),
      done: [],
      quiz: new Set<string>(),
      byDone: false,
    };
    const a = lessonsAccess(c, START, now, {
      ...gate,
      hw: new Map([
        [id(1), "accepted" as const],
        [id(2), "accepted" as const],
      ]),
    });
    expect(a.map((x) => x.open)).toEqual([true, true, true, true]);
  });

  it("разбор расписания: запись с запасом, неизвестный режим — «все сразу»", () => {
    const raw = (schedule: unknown) => JSON.stringify({ schedule, lessons });
    expect(parseCourse(raw({ mode: "tasks" })).schedule).toEqual({
      mode: "tasks",
      unlock: "accepted",
    });
    expect(parseCourse(raw({ mode: "tasks", unlock: "submitted" })).schedule).toEqual({
      mode: "tasks",
      unlock: "submitted",
    });
    expect(parseCourse(raw({ mode: "tasks", unlock: "x" })).schedule).toEqual({
      mode: "tasks",
      unlock: "accepted",
    });
    expect(parseCourse(raw({ mode: "weird" })).schedule).toEqual({ mode: "all" });
  });
});

describe("урок после ДЗ: настоящий путь сдачи и проверки", () => {
  it("закрыт до приёма, открыт после; возврат на доработку не закрывает открытый", async () => {
    const { ctx } = shop(course("accepted"));
    expect(await opens(ctx)).toEqual([true, false, false, false]);
    const first = await submit(ctx, id(1));
    const rev = first.ok ? first.homework.rev : -1;
    // Сдано, но не принято — режим «accepted» урок 2 не открывает.
    expect(await opens(ctx)).toEqual([true, false, false, false]);
    expect((await review(ctx, id(1), rev, "revise")).ok).toBe(true);
    expect(await opens(ctx)).toEqual([true, false, false, false]);
    const again = await submit(ctx, id(1));
    expect((await review(ctx, id(1), again.ok ? again.homework.rev : -1, "accepted")).ok).toBe(
      true,
    );
    expect(await opens(ctx)).toEqual([true, true, false, false]);
    // Урок 2 сдан и возвращён на доработку: урок 3 пока закрыт, но урок 2 остаётся открытым.
    const second = await submit(ctx, id(2));
    await review(ctx, id(2), second.ok ? second.homework.rev : -1, "revise");
    expect(await opens(ctx)).toEqual([true, true, false, false]);
  });

  it("режим «когда сдано»: достаточно сдачи, даже если вернули на доработку", async () => {
    const { ctx } = shop(course("submitted"));
    expect(await opens(ctx)).toEqual([true, false, false, false]);
    const first = await submit(ctx, id(1));
    expect(await opens(ctx)).toEqual([true, true, false, false]);
    await review(ctx, id(1), first.ok ? first.homework.rev : -1, "revise");
    expect(await opens(ctx)).toEqual([true, true, false, false]);
  });

  it("тариф без проверки ДЗ: сдавать нельзя, следующий урок — по отметке «пройден»", async () => {
    const { ctx } = shop(course("accepted"), V_NOHW);
    expect(await submit(ctx, id(1))).toEqual({ ok: false, reason: "notInTariff" });
    expect(await opens(ctx)).toEqual([true, false, false, false]);
    await markLesson(ctx, (await coursePurchase(ctx, ITEM))!, id(1), true, NOW);
    expect(await opens(ctx)).toEqual([true, true, false, false]);
  });

  it("закрытый урок нельзя отметить и сдать", async () => {
    const { ctx } = shop(course("accepted"));
    expect(await submit(ctx, id(2))).toEqual({ ok: false, reason: "closed" });
    const run = await markLesson(ctx, (await coursePurchase(ctx, ITEM))!, id(2), true, NOW);
    expect(run.done).toEqual([]);
  });

  it("сбой чтения сдач — ошибка, а не «ничего не сдано»", async () => {
    const { ctx, db } = shop(course("accepted"));
    const real = db.from.bind(db);
    (db as { from: unknown }).from = (table: string) => {
      const q = real(table) as unknown as Record<string, unknown>;
      if (table !== "app_settings") return q;
      const origLike = q.like as (...a: unknown[]) => unknown;
      q.like = (...a: unknown[]) => {
        const r = origLike.apply(q, a) as Record<string, unknown>;
        r.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } });
        return r;
      };
      return q;
    };
    await expect(coursePurchase(ctx, ITEM)).rejects.toThrow(/Сдачи заданий не прочитаны/);
  });
});

describe("урок после ДЗ: крон «новый урок»", () => {
  it("принятое ДЗ открывает урок — ученику уходит одно сообщение, повтор молчит", async () => {
    const { ctx, db } = shop(course("accepted"));
    // Ученик начал курс (прохождение), урок 1 ему известен.
    db.tables.app_settings!.push({
      bot_id: T,
      key: `course_run_${ITEM}`,
      value: JSON.stringify({ startedAt: "2026-09-30T10:00:00Z", done: [], notified: 1 }),
    });
    (ctx as { appUrl?: string }).appUrl = "https://www.frogflow.tech";
    (ctx.tenant as { settings: Record<string, unknown> }).settings = { slug: "school" };
    const sent: number[] = [];
    const send = async (a: { lessonNo: number }) => {
      sent.push(a.lessonNo);
      return true;
    };
    const { setEnvForTests } = await import("@/config/env");
    setEnvForTests({});
    try {
      expect(await announceNewLessons(ctx, send, NOW)).toMatchObject({ sent: 0 });
      const first = await submit(ctx, id(1));
      await review(ctx, id(1), first.ok ? first.homework.rev : -1, "accepted");
      expect(await announceNewLessons(ctx, send, NOW)).toMatchObject({ sent: 1 });
      expect(await announceNewLessons(ctx, send, NOW)).toMatchObject({ sent: 0 });
      expect(sent).toEqual([2]);
      expect((await loadRuns(ctx))[0]!.hw?.get(id(1))).toBe("accepted");
    } finally {
      setEnvForTests(undefined);
    }
  });
});

describe("урок с тестом в режиме «по заданиям»: тест и ДЗ вместе", () => {
  const quiz = { pass: 100, questions: [{ text: "2+2?", options: ["3", "4"], correct: [1] }] };
  const withQuiz: Course = {
    schedule: { mode: "tasks", unlock: "accepted" },
    lessons: [{ ...lessons[0]!, quiz }, { ...lessons[2]!, id: id(2), quiz }, { ...lessons[2]! }],
  };
  const takeQuiz = async (ctx: TenantContext, lesson: string, answer: number) =>
    submitQuiz(ctx, (await coursePurchase(ctx, ITEM))!, lesson, [[answer]], 0, NOW);

  it("нужны и принятое ДЗ, и пройденный тест: по отдельности следующий урок закрыт", async () => {
    const { ctx } = shop(withQuiz);
    expect(await opens(ctx)).toEqual([true, false, false]);
    // Только тест — ДЗ не принято.
    expect((await takeQuiz(ctx, id(1), 1)).ok).toBe(true);
    expect(await opens(ctx)).toEqual([true, false, false]);
    // Принятое ДЗ при пройденном тесте открывает урок 2.
    const hw = await submit(ctx, id(1));
    await review(ctx, id(1), hw.ok ? hw.homework.rev : -1, "accepted");
    expect(await opens(ctx)).toEqual([true, true, false]);
  });

  it("принятое ДЗ без теста урок не открывает; непройденный тест — тоже", async () => {
    const { ctx } = shop(withQuiz);
    const hw = await submit(ctx, id(1));
    await review(ctx, id(1), hw.ok ? hw.homework.rev : -1, "accepted");
    expect(await opens(ctx)).toEqual([true, false, false]);
    const wrong = await takeQuiz(ctx, id(1), 0);
    expect(wrong.ok && wrong.grade.passed).toBe(false);
    expect(await opens(ctx)).toEqual([true, false, false]);
  });

  it("урок только с тестом: пройденный тест открывает следующий", async () => {
    const { ctx } = shop(withQuiz);
    const hw = await submit(ctx, id(1));
    await review(ctx, id(1), hw.ok ? hw.homework.rev : -1, "accepted");
    await takeQuiz(ctx, id(1), 1);
    expect(await opens(ctx)).toEqual([true, true, false]);
    expect((await takeQuiz(ctx, id(2), 1)).ok).toBe(true);
    expect(await opens(ctx)).toEqual([true, true, true]);
  });

  it("крон видит тот же набор: пройденные тесты читаются для всех покупок", async () => {
    const { ctx } = shop(withQuiz);
    const hw = await submit(ctx, id(1));
    await review(ctx, id(1), hw.ok ? hw.homework.rev : -1, "accepted");
    await takeQuiz(ctx, id(1), 1);
    const run = (await loadRuns(ctx)).find((r) => r.itemId === ITEM)!;
    expect([...(run.quiz ?? [])]).toEqual([id(1)]);
  });
});
