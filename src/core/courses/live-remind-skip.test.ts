import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey } from "./course";

vi.mock("@/config/env", () => ({ env: () => ({ SECRETS_KEY: "s", APP_URL: "https://a.test" }) }));
const { liveReminders, shopHasLives } = await import("./live-remind.server");
const { runKey } = await import("./run.server");

/** Крон эфиров каждые 10 минут: нет эфиров в курсах — прохождения и заказы не читаются (Ш4, партия 13). */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const lesson = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "К",
  text: "т",
  files: [],
  link: null,
};

function shop(lives: boolean) {
  const course = {
    schedule: { mode: "all" },
    lessons: [lesson],
    cohorts: [
      {
        id: C1,
        title: "Октябрь",
        start: "2026-10-15T10:00",
        enrollUntil: null,
        ...(lives
          ? {
              lives: [
                {
                  id: "e0000000-0000-4000-8000-000000000001",
                  title: "Э",
                  at: "2026-10-20T19:00",
                  link: null,
                },
              ],
            }
          : {}),
      },
    ],
  };
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], cohortId: C1 }),
    },
  ];
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: null, name_snapshot: "Курс" },
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
  const touched: string[] = [];
  const from = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => (
    touched.push(t),
    from(t)
  );
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://a.test",
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, touched };
}

describe("ранний выход крона эфиров", () => {
  it("в курсах нет эфиров — заказы и позиции заказов не читаются, ничего не отправлено", async () => {
    const { ctx, touched } = shop(false);
    expect(await shopHasLives(ctx)).toBe(false);
    const sent: unknown[] = [];
    const stats = await liveReminders(
      ctx,
      async (r) => (sent.push(r), true),
      new Date("2026-10-20T15:00:00Z"),
    );
    expect(stats).toEqual({ sent: 0, failed: 0, silent: 0 });
    expect(sent).toEqual([]);
    expect(touched).not.toContain("orders");
    expect(touched).not.toContain("order_items");
  });

  it("эфир есть — крон работает как раньше и шлёт напоминание", async () => {
    const { ctx, touched } = shop(true);
    expect(await shopHasLives(ctx)).toBe(true);
    const sent: unknown[] = [];
    const stats = await liveReminders(
      ctx,
      async (r) => (sent.push(r), true),
      new Date("2026-10-20T15:00:00Z"),
    );
    expect(stats).toMatchObject({ sent: 1 });
    expect(touched).toContain("orders");
  });

  it("сбой чтения курсов — ошибка, а не «эфиров нет»", async () => {
    const { ctx } = shop(true);
    (ctx.db as unknown as { from: () => unknown }).from = () => {
      throw new Error("db down");
    };
    await expect(shopHasLives(ctx)).rejects.toThrow();
  });

  it("записи на каждого ученика (course_inv_, course_cert_, course_seen_) не читаются: запросов не больше, чем у пустого магазина", async () => {
    const { ctx, touched } = shop(false);
    const rows = (ctx.db as unknown as ReturnType<typeof fakeDb>).tables.app_settings as Array<
      Record<string, unknown>
    >;
    for (let i = 0; i < 300; i++)
      for (const p of ["course_inv_", "course_cert_", "course_seen_"])
        rows.push({
          bot_id: T,
          key: `${p}${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
          value: "{}",
        });
    expect(await shopHasLives(ctx)).toBe(false);
    const withStudents = touched.filter((t) => t === "app_settings").length;
    const empty = shop(false);
    await shopHasLives(empty.ctx);
    expect(withStudents).toBe(empty.touched.filter((t) => t === "app_settings").length);
  });
});
