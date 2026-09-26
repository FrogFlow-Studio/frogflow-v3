import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { lessonsAccess, nextOpening } from "./access";
import { courseKey, type Course } from "./course";
import { courseToken, coursePath, isCourseToken } from "./link";
import { coursePurchase, markLesson, parseRun, runKey, startRun } from "./run.server";

const T = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const START = "2026-10-01T09:00:00.000Z";
const at = (days: number, hours = 0) => Date.parse(START) + days * 86_400_000 + hours * 3_600_000;

const lesson = (n: number) => ({ id: id(n), title: `Урок ${n}`, text: "т", files: [], link: null });
const drip: Course = { schedule: { mode: "drip", everyDays: 2 }, lessons: [1, 2, 3].map(lesson) };

describe("курс — какие уроки открыты", () => {
  it("по расписанию: первый сразу, дальше раз в N дней от начала прохождения", () => {
    const now = at(2, 1);
    const a = lessonsAccess(drip, START, now);
    expect(a.map((x) => x.open)).toEqual([true, true, false]);
    expect(a[2]!.opensAt).toBe(new Date(at(4)).toISOString());
    expect(nextOpening(a)?.no).toBe(3);
  });

  it("ровно в момент открытия урок уже открыт", () => {
    expect(lessonsAccess(drip, START, at(2))[1]!.open).toBe(true);
    expect(lessonsAccess(drip, START, at(2) - 1)[1]!.open).toBe(false);
  });

  it("все сразу — всё открыто в момент начала", () => {
    const all: Course = { ...drip, schedule: { mode: "all" } };
    const a = lessonsAccess(all, START, at(0));
    expect(a.every((x) => x.open)).toBe(true);
    expect(nextOpening(a)).toBeNull();
  });
});

describe("курс — ссылка покупателю", () => {
  const S = "secret-key";
  it("подпись своей позиции проходит, чужой позиции и чужого магазина — нет", () => {
    const k = courseToken(S, T, ITEM);
    expect(isCourseToken(S, T, ITEM, k)).toBe(true);
    expect(isCourseToken(S, T, id(1), k)).toBe(false);
    expect(isCourseToken(S, OTHER, ITEM, k)).toBe(false);
    expect(isCourseToken("other", T, ITEM, k)).toBe(false);
    expect(isCourseToken(S, T, ITEM, "")).toBe(false);
    expect(isCourseToken(S, T, ITEM, k.slice(0, -1) + (k.endsWith("A") ? "B" : "A"))).toBe(false);
  });
  it("путь на витрине", () => {
    expect(coursePath("shop", ITEM, "abc")).toBe(`/s/shop/course/${ITEM}?k=abc`);
  });
});

function setup(status: string, course: Course | null = drip) {
  const db = fakeDb();
  db.tables.order_items = [{ id: ITEM, order_id: 7, product_id: P, name_snapshot: "Курс" }];
  db.tables.orders = [{ id: 7, status }];
  db.tables.app_settings = course ? [{ key: courseKey(P), value: JSON.stringify(course) }] : [];
  const ctx = { tenant: { id: T }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("курс — покупка и прохождение", () => {
  it("открывается только выданный заказ с уроками", async () => {
    for (const status of ["awaiting_payment", "awaiting_confirmation", "cancelled"])
      expect(await coursePurchase(setup(status).ctx, ITEM)).toBeNull();
    expect(await coursePurchase(setup("delivered", null).ctx, ITEM)).toBeNull();
    expect(await coursePurchase(setup("delivered").ctx, id(9))).toBeNull();
    const p = await coursePurchase(setup("delivered").ctx, ITEM);
    expect(p?.course.lessons).toHaveLength(3);
    expect(p?.run).toBeNull();
  });

  it("дата начала ставится один раз", async () => {
    const { ctx, db } = setup("delivered");
    const p = (await coursePurchase(ctx, ITEM))!;
    const run = await startRun(ctx, p, new Date(START));
    expect(run.startedAt).toBe(START);
    const again = (await coursePurchase(ctx, ITEM))!;
    expect(await startRun(ctx, again, new Date(at(5)))).toEqual(run);
    expect(db.tables.app_settings!.filter((r) => r.key === runKey(ITEM))).toHaveLength(1);
  });

  it("отметить можно только открытый урок этого курса; снять отметку можно", async () => {
    const { ctx } = setup("delivered");
    const p = (await coursePurchase(ctx, ITEM))!;
    const now = new Date(at(0, 1));
    let run = await markLesson(ctx, p, id(1), true, now);
    expect(run.done).toEqual([id(1)]);
    run = await markLesson(ctx, { ...p, run }, id(3), true, now);
    expect(run.done).toEqual([id(1)]);
    run = await markLesson(ctx, { ...p, run }, id(9), true, now);
    expect(run.done).toEqual([id(1)]);
    run = await markLesson(ctx, { ...p, run }, id(1), false, now);
    expect(run.done).toEqual([]);
  });

  it("битая запись прохождения читается как «не начат»", () => {
    expect(parseRun("{")).toBeNull();
    expect(parseRun('{"startedAt":"вчера"}')).toBeNull();
    expect(parseRun(JSON.stringify({ startedAt: START, done: ["a", "a", 1] }))).toEqual({
      startedAt: START,
      done: ["a"],
    });
  });
});
