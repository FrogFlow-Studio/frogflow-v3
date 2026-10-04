import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, hasCourseContent, type Course } from "./course";
import { COURSE_MARKER_URL } from "./marker";

vi.mock("@/config/env", () => ({ env: () => ({ SECRETS_KEY: "s", APP_URL: "https://a.test" }) }));
vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/core/orders/orders", () => ({
  listDeliveredOrders: async () => [
    {
      id: 7,
      created_at: "2026-10-01T00:00:00Z",
      order_items: [
        { id: "item-1", product_id: P, product_variant_id: null, name_snapshot: "Марафон" },
      ],
    },
  ],
}));

const { coursePurchase } = await import("./run.server");
const { customerCourses } = await import("./mine.server");
const { loadRuns } = await import("./runs.server");
const { saveCourse } = await import("./course.server");
const { saveLive, deleteLive } = await import("./lives.server");
const { courseMaterials } = await import("./delivery.server");
const { runKey, startRunAtDelivery } = await import("./run.server");
const { courseEnrollOpen } = await import("./enroll.server");
const { courseSegmentMembers } = await import("./segment.server");
const { coursePreview } = await import("./preview.server");
const { liveReminders } = await import("./live-remind.server");

/** Курс из одних эфиров (Ш1, партия 13): без уроков ученик всё равно купил курс. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const LIVE = "e0000000-0000-4000-8000-000000000001";
const onlyLives: Course = {
  schedule: { mode: "all" },
  lessons: [],
  cohorts: [
    {
      id: C1,
      title: "Октябрь",
      start: "2026-10-15T10:00",
      enrollUntil: null,
      lives: [{ id: LIVE, title: "Вебинар", at: "2026-10-20T19:00", link: "https://zoom.us/j/9" }],
    },
  ],
};

function school(c: Course, file_url: string | null = null) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [{ id: P, bot_id: T, fulfillment_kind: "digital", file_url }];
  db.tables.order_items = [
    {
      id: "item-1",
      order_id: 7,
      product_id: P,
      product_variant_id: null,
      name_snapshot: "Марафон",
    },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(c) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], cohortId: C1 }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://a.test",
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}
const product = (db: ReturnType<typeof fakeDb>) =>
  (db.tables.products as Array<Record<string, unknown>>)[0]!;

describe("курс из одних эфиров", () => {
  it("hasCourseContent: уроки или эфиры потоков; пустой курс — нет", () => {
    expect(hasCourseContent(onlyLives)).toBe(true);
    expect(hasCourseContent({ schedule: { mode: "all" }, lessons: [] })).toBe(false);
    expect(
      hasCourseContent({
        schedule: { mode: "all" },
        lessons: [],
        cohorts: [{ id: C1, title: "", start: "2026-10-15T10:00", enrollUntil: null }],
      }),
    ).toBe(false);
  });

  it("страница курса: покупка находится (не 404)", async () => {
    const { ctx } = school(onlyLives);
    const p = await coursePurchase(ctx, "item-1");
    expect(p?.name).toBe("Марафон");
  });

  it("«Мои курсы» в боте: курс есть, кнопка «Эфиры» включена", async () => {
    const { ctx } = school(onlyLives);
    const list = await customerCourses(ctx, {} as never, new Date("2026-10-16T00:00:00Z"));
    expect(list).toHaveLength(1);
    expect(list[0]!.lives).toBe(true);
    expect(list[0]!.total).toBe(0);
  });

  it("кроны: покупка видна loadRuns (напоминания об эфирах)", async () => {
    const { ctx } = school(onlyLives);
    const runs = await loadRuns(ctx);
    expect(runs.map((r) => r.itemId)).toEqual(["item-1"]);
  });

  it("выдача: ссылка на курс приходит", async () => {
    const { ctx } = school(onlyLives);
    const m = await courseMaterials(ctx, { id: "item-1", product_id: P });
    expect(m.length).toBeGreaterThan(0);
  });

  it("сохранение формы курса с уже записанными эфирами отмечает товар курсом", async () => {
    const { ctx, db } = school({
      schedule: { mode: "all" },
      lessons: [],
      cohorts: onlyLives.cohorts!.map((c) => ({ ...c, lives: undefined })),
    });
    await saveCourse(ctx, P, {
      schedule: { mode: "all" },
      lessons: [],
      cohorts: [{ id: C1, title: "Октябрь", start: "2026-10-15T10:00", enrollUntil: null }],
    });
    expect(product(db).file_url).toBeNull();
    await saveLive(ctx, P, C1, { id: LIVE, title: "Вебинар", at: "2026-10-20T19:00", link: null });
    expect(product(db).file_url).toBe(COURSE_MARKER_URL);
    await saveCourse(ctx, P, {
      schedule: { mode: "all" },
      lessons: [],
      cohorts: [{ id: C1, title: "Октябрь", start: "2026-10-15T10:00", enrollUntil: null }],
    });
    expect(product(db).file_url).toBe(COURSE_MARKER_URL);
    await deleteLive(ctx, P, C1, LIVE);
    expect(product(db).file_url).toBeNull();
  });

  it("выдача заводит прохождение, крон за час до эфира шлёт напоминание (настоящий путь)", async () => {
    const { ctx, db } = school(onlyLives);
    db.tables.app_settings = (db.tables.app_settings as Array<{ key: string }>).filter(
      (r) => r.key !== runKey("item-1"),
    );
    await startRunAtDelivery(ctx, { id: "item-1", order_id: 7, product_id: P });
    expect(
      (db.tables.app_settings as Array<{ key: string }>).some((r) => r.key === runKey("item-1")),
    ).toBe(true);
    const sent: unknown[] = [];
    const stats = await liveReminders(
      ctx,
      async (r) => (sent.push(r), true),
      new Date("2026-10-20T15:00:00Z"),
    );
    expect(stats).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it("набор: закрытый набор курса из эфиров закрыт для продажи", async () => {
    const closed: Course = {
      ...onlyLives,
      cohorts: [{ ...onlyLives.cohorts![0]!, enrollUntil: "2026-10-05" }],
    };
    const { ctx } = school(closed);
    expect(await courseEnrollOpen(ctx, P, new Date("2026-10-10T00:00:00Z"))).toBe(false);
    expect(await courseEnrollOpen(ctx, P, new Date("2026-10-01T00:00:00Z"))).toBe(true);
  });

  it("сегмент «прошли курс»: курс без уроков никого не считает прошедшим", async () => {
    const { ctx } = school(onlyLives);
    const now = new Date("2026-10-16T00:00:00Z");
    expect([...(await courseSegmentMembers(ctx, P, "completed", null, now))]).toEqual([]);
    expect([...(await courseSegmentMembers(ctx, P, "all", null, now))]).toEqual([555]);
  });

  it("предпросмотр в админке: курс из эфиров не пустой", async () => {
    const { ctx } = school(onlyLives);
    const pv = await coursePreview(ctx, P, new Date("2026-10-01T00:00:00Z"));
    expect(pv).not.toBeNull();
    expect(pv!.lessons).toEqual([]);
    expect(pv!.cohort?.title).toBe("Октябрь");
  });
});
