import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  ENGAGE_WEB_BUDGET,
  engageStats,
  foldEngage,
  recordEngage,
  recordWebEngage,
} from "./engage";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const DAY = 86_400_000;

function setup(botId = "bot-eng") {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]], app_settings: [["key"]] } });
  db.tables.zernio_logs = [];
  db.tables.app_settings = [];
  const ctx = { db, tenant: { id: botId } } as unknown as TenantContext;
  return { db, ctx };
}

describe("итоги подбора и допродажи", () => {
  it("считает события за 30 дней: квиз и добавления из «С этим берут», разные покупатели отдельно", async () => {
    const { ctx } = setup();
    const at = (d: number) => new Date(NOW - d * DAY);
    await recordEngage(ctx, "quiz_done", 1, at(1));
    await recordEngage(ctx, "quiz_done", 1, at(2)); // тот же покупатель — второе прохождение
    await recordEngage(ctx, "quiz_done", 2, at(3));
    await recordWebEngage(ctx, "quiz_done", at(3)); // сайт без входа
    await recordEngage(ctx, "upsell_add", 1, at(1));
    await recordWebEngage(ctx, "upsell_add", at(5));
    await recordWebEngage(ctx, "upsell_add", at(5));
    // Старше 30 дней — в итоги не попадает.
    await recordEngage(ctx, "quiz_done", 3, at(31));
    expect(await engageStats(ctx, NOW)).toEqual({
      quizDone: 4,
      quizBuyers: 2,
      upsellAdded: 3,
      upsellBuyers: 1,
    });
  });

  it("два события в одну миллисекунду — две строки, а не одна", async () => {
    const { db, ctx } = setup();
    const t = new Date(NOW);
    await Promise.all([
      recordEngage(ctx, "upsell_add", 1, t),
      recordEngage(ctx, "upsell_add", 1, t),
    ]);
    expect(db.tables.zernio_logs).toHaveLength(2);
  });

  it("покупатель сайта: сто нажатий — одна строка счётчика, журнал не растёт, итоги верны", async () => {
    const { db, ctx } = setup("bot-web-1");
    const t = new Date(NOW - DAY);
    await Promise.all(Array.from({ length: 50 }, () => recordWebEngage(ctx, "upsell_add", t)));
    expect(db.tables.zernio_logs).toHaveLength(0);
    const rows = db.tables.app_settings!.filter((r) => String(r.key).startsWith("engage_web:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "engage_web:upsell_add:2026-10-03", value: "50" });
    expect(await engageStats(ctx, NOW)).toMatchObject({ upsellAdded: 50, upsellBuyers: 0 });
  });

  it("потолок в час: сверх него счётчик не растёт", async () => {
    const { db, ctx } = setup("bot-web-2");
    let counted = 0;
    for (let i = 0; i < ENGAGE_WEB_BUDGET.limit + 5; i++)
      if (await recordWebEngage(ctx, "quiz_done", new Date(NOW))) counted++;
    expect(counted).toBeLessThanOrEqual(ENGAGE_WEB_BUDGET.limit);
    expect(counted).toBeGreaterThan(ENGAGE_WEB_BUDGET.limit - 5);
    const row = db.tables.app_settings!.find((r) => r.key === "engage_web:quiz_done:2026-10-04")!;
    expect(Number(row.value)).toBe(counted);
  });

  it("счётчики старше 35 дней убираются при первой записи нового дня; 30 дней в итоги входят, 32 — нет", async () => {
    const { db, ctx } = setup("bot-web-3");
    const old = (d: number) =>
      `engage_web:quiz_done:${new Date(NOW - d * DAY).toISOString().slice(0, 10)}`;
    db.tables.app_settings!.push(
      { bot_id: "bot-web-3", key: old(60), value: "9", updated_at: "2026-08-01T00:00:00Z" },
      { bot_id: "bot-web-3", key: old(32), value: "5", updated_at: "2026-09-01T00:00:00Z" },
      { bot_id: "bot-web-3", key: old(10), value: "3", updated_at: "2026-09-24T00:00:00Z" },
    );
    expect((await engageStats(ctx, NOW)).quizDone).toBe(3);
    await recordWebEngage(ctx, "quiz_done", new Date(NOW));
    const keys = db.tables.app_settings!.map((r) => r.key);
    expect(keys).not.toContain(old(60));
    expect(keys).toContain(old(10));
    expect((await engageStats(ctx, NOW)).quizDone).toBe(4);
  });

  it("чужой магазин и чужие события не считаются", async () => {
    const { db, ctx } = setup();
    await recordEngage(ctx, "quiz_done", 1, new Date(NOW));
    db.tables.zernio_logs!.push(
      {
        id: 90,
        bot_id: "other",
        event_type: "engage",
        payload: { kind: "quiz_done", telegram_id: 9 },
        created_at: new Date(NOW).toISOString(),
      },
      {
        id: 91,
        bot_id: "bot-eng",
        event_type: "automsg",
        payload: { kind: "quiz_done", telegram_id: 9 },
        created_at: new Date(NOW).toISOString(),
      },
    );
    expect((await engageStats(ctx, NOW)).quizDone).toBe(1);
  });

  it("сбой записи не роняет действие покупателя", async () => {
    const { db, ctx } = setup();
    db.from = (() => {
      throw new Error("база недоступна");
    }) as unknown as typeof db.from;
    await expect(recordEngage(ctx, "quiz_done", 1)).resolves.toBeUndefined();
  });

  it("сбой чтения итогов — ошибка, а не нули", async () => {
    const { db, ctx } = setup();
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t) as unknown as Record<string, unknown>;
      q.range = async () => ({ data: null, error: { message: "boom" } });
      return q;
    }) as unknown as typeof db.from;
    await expect(engageStats(ctx, NOW)).rejects.toBeTruthy();
  });

  it("мусор в payload пропускается", () => {
    expect(
      foldEngage([{ payload: null }, { payload: { kind: "other" } }, { payload: "x" }]),
    ).toEqual({ quizDone: 0, quizBuyers: 0, upsellAdded: 0, upsellBuyers: 0 });
  });
});
