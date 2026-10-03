import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { adjustCustomerPoints } from "./adjust";

const KEY = "tg:777";

function setup(points: number | null = 100) {
  const db = fakeDb();
  db.tables.bot_users = [
    { telegram_id: 777, user_key: KEY, loyalty_points: points, state: { keep: "me" } },
    { telegram_id: 888, user_key: "tg:888", loyalty_points: 50, state: {} },
  ];
  const ctx = { tenant: { id: "bot" }, db } as unknown as TenantContext;
  const balance = (i = 0) => db.tables.bot_users![i]!.loyalty_points;
  return { db, ctx, balance };
}

describe("ручная правка баллов", () => {
  it("начисляет и списывает дельтой, чужого покупателя и state не трогает", async () => {
    const { db, ctx, balance } = setup();
    expect(await adjustCustomerPoints(ctx, KEY, 40, "Компенсация за задержку")).toEqual({
      ok: true,
      before: 100,
      after: 140,
    });
    expect(await adjustCustomerPoints(ctx, KEY, -90, "Начислили по ошибке")).toEqual({
      ok: true,
      before: 140,
      after: 50,
    });
    expect(balance(0)).toBe(50);
    expect(balance(1)).toBe(50);
    expect(db.tables.bot_users![0]!.state).toEqual({ keep: "me" });
  });

  it("не уходит ниже нуля: баланс остаётся, ответ называет остаток", async () => {
    const { ctx, balance } = setup(30);
    expect(await adjustCustomerPoints(ctx, KEY, -31, "Списать лишнее")).toEqual({
      ok: false,
      reason: "negative",
      points: 30,
    });
    expect(balance()).toBe(30);
    expect(await adjustCustomerPoints(ctx, KEY, -30, "Списать всё")).toMatchObject({
      ok: true,
      after: 0,
    });
  });

  it("покупателя нет — not_found, ничего не создаётся", async () => {
    const { db, ctx } = setup();
    expect(await adjustCustomerPoints(ctx, "tg:1", 10, "Компенсация")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(db.tables.bot_users).toHaveLength(2);
  });

  it("баланс NULL считается нулём", async () => {
    const { ctx, balance } = setup(null);
    expect(await adjustCustomerPoints(ctx, KEY, 25, "Стартовые баллы")).toMatchObject({
      ok: true,
      before: 0,
      after: 25,
    });
    expect(balance()).toBe(25);
  });

  it("без причины, с нулём, дробью и огромной суммой — отказ до чтения базы", async () => {
    const { ctx, balance } = setup();
    await expect(adjustCustomerPoints(ctx, KEY, 10, "  ")).rejects.toThrow(RangeError);
    await expect(adjustCustomerPoints(ctx, KEY, 10, "ab")).rejects.toThrow(RangeError);
    await expect(adjustCustomerPoints(ctx, KEY, 10, "x".repeat(121))).rejects.toThrow(RangeError);
    await expect(adjustCustomerPoints(ctx, KEY, 0, "Компенсация")).rejects.toThrow(RangeError);
    await expect(adjustCustomerPoints(ctx, KEY, 1.5, "Компенсация")).rejects.toThrow(RangeError);
    await expect(adjustCustomerPoints(ctx, KEY, 1_000_001, "Компенсация")).rejects.toThrow(
      RangeError,
    );
    expect(balance()).toBe(100);
  });

  it("гонка: две правки одновременно — применились обе, ни одна не затёрта", async () => {
    const { ctx, balance } = setup();
    const results = await Promise.all([
      adjustCustomerPoints(ctx, KEY, 50, "Компенсация раз"),
      adjustCustomerPoints(ctx, KEY, -30, "Компенсация два"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(balance()).toBe(120);
  });

  it("гонка: баллы ушли на заказ между чтением и записью — правка повторяется от нового значения", async () => {
    const { db, ctx, balance } = setup();
    // Первое обновление «проигрывает»: заказ списал 60 баллов между чтением и записью.
    const realFrom = db.from.bind(db);
    let raced = false;
    db.from = ((table: string) => {
      const q = realFrom(table) as unknown as { update: (p: Record<string, unknown>) => unknown };
      const update = q.update.bind(q);
      q.update = (patch: Record<string, unknown>) => {
        if (!raced && table === "bot_users") {
          raced = true;
          db.tables.bot_users![0]!.loyalty_points = 40;
        }
        return update(patch);
      };
      return q;
    }) as typeof db.from;
    expect(await adjustCustomerPoints(ctx, KEY, 10, "Компенсация")).toMatchObject({
      ok: true,
      before: 40,
      after: 50,
    });
    expect(balance()).toBe(50);
  });
});
