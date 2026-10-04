import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { engageStats, foldEngage, recordEngage } from "./engage";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const DAY = 86_400_000;

function setup() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  const ctx = { db, tenant: { id: "bot-eng" } } as unknown as TenantContext;
  return { db, ctx };
}

describe("итоги подбора и допродажи", () => {
  it("считает события за 30 дней: квиз и добавления из «С этим берут», разные покупатели отдельно", async () => {
    const { ctx } = setup();
    const at = (d: number) => new Date(NOW - d * DAY);
    await recordEngage(ctx, "quiz_done", 1, at(1));
    await recordEngage(ctx, "quiz_done", 1, at(2)); // тот же покупатель — второе прохождение
    await recordEngage(ctx, "quiz_done", 2, at(3));
    await recordEngage(ctx, "quiz_done", null, at(3)); // сайт без входа
    await recordEngage(ctx, "upsell_add", 1, at(1));
    await recordEngage(ctx, "upsell_add", null, at(5));
    await recordEngage(ctx, "upsell_add", null, at(5));
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
      recordEngage(ctx, "upsell_add", null, t),
      recordEngage(ctx, "upsell_add", null, t),
    ]);
    expect(db.tables.zernio_logs).toHaveLength(2);
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
