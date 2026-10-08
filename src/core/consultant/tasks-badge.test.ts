import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import { addTask, setTaskDone, TASKS_KEY } from "./tasks";
import { openTasksCount } from "./tasks-badge";

let n = 0;
function ctxOf() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const ctx = {
    tenant: {
      id: `20000000-0000-0000-0000-00000000000${++n}`,
      name: "BOVI",
      settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
      modules: {},
      vertical: "consultant",
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

const task = (userKey: string) => ({ userKey, reason: "purchase", text: "Хочет комплект" });
const row = (db: ReturnType<typeof ctxOf>["db"]) =>
  db.tables.app_settings!.find((r) => r.key === TASKS_KEY)!;

describe("бейдж «Задачи» в шапке", () => {
  it("нет списка — 0; есть — число открытых", async () => {
    const { ctx } = ctxOf();
    expect(await openTasksCount(ctx)).toBe(0);
    const a = await addTask(ctx, task("tg:1"), new Date("2026-10-08T10:00:00Z"));
    await addTask(ctx, task("tg:2"), new Date("2026-10-08T10:01:00Z"));
    expect(await openTasksCount(ctx)).toBe(2);
    await setTaskDone(ctx, a!.id, true);
    expect(await openTasksCount(ctx)).toBe(1);
  });

  it("пока отметка времени та же, список заново не читается", async () => {
    const { ctx, db } = ctxOf();
    await addTask(ctx, task("tg:1"));
    const now = Date.now();
    expect(await openTasksCount(ctx, now)).toBe(1);
    // Подменяем список, не трогая updated_at: шапка видит прежний счёт — значит, JSON не читала.
    row(db).value = "[]";
    expect(await openTasksCount(ctx, now + 1000)).toBe(1);
    // Новая отметка (так пишет каждая запись задач) — список перечитан.
    row(db).updated_at = new Date(now + 5000).toISOString();
    expect(await openTasksCount(ctx, now + 6000)).toBe(0);
  });

  it("память не дольше двух минут, даже при той же отметке", async () => {
    const { ctx, db } = ctxOf();
    await addTask(ctx, task("tg:1"));
    const now = Date.now();
    expect(await openTasksCount(ctx, now)).toBe(1);
    row(db).value = "[]";
    expect(await openTasksCount(ctx, now + 3 * 60_000)).toBe(0);
  });

  it("сбой чтения — ошибка, а не «0»", async () => {
    const { ctx } = ctxOf();
    const broken = {
      ...ctx,
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
          }),
        }),
      },
    } as unknown as TenantContext;
    await expect(openTasksCount(broken)).rejects.toThrow();
  });
});
