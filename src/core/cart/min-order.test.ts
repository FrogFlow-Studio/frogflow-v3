import { afterEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setFxProvider } from "@/core/pricing/pricing";
import { fakeDb } from "../../../tests/fake-db";
import { belowMinimum, loadMinOrder, parseMinOrder, saveMinOrder } from "./min-order";

const T = "11111111-2222-3333-4444-555555555555";

function setup(min: string | null, currency = "KZT") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    ...(min === null ? [] : [{ bot_id: T, key: "min_order_amount", value: min }]),
    { bot_id: T, key: "shop_currency", value: currency },
  ];
  return {
    ctx: { tenant: { id: T, modules: {}, settings: {} }, db } as unknown as TenantContext,
    db,
  };
}

afterEach(() => setFxProvider(async () => ({ USD: 1, KZT: 500, RUB: 80 })));

describe("минимальная сумма заказа", () => {
  it("разбор: положительное число; пусто, 0, мусор и отрицательное — без минимума", () => {
    expect(parseMinOrder("2500")).toBe(2500);
    expect(parseMinOrder("99.5")).toBe(99.5);
    for (const v of [null, undefined, "", "0", "-5", "abc", "1e12"])
      expect(parseMinOrder(v)).toBe(0);
  });

  it("сохраняется и читается; 0 снимает минимум", async () => {
    const { ctx } = setup(null);
    await saveMinOrder(ctx, 3000);
    expect(await loadMinOrder(ctx)).toBe(3000);
    await saveMinOrder(ctx, 0);
    expect(await loadMinOrder(ctx)).toBe(0);
  });

  it("меньше минимума — сколько добрать; равно и больше — можно; пустая корзина и бесплатное — можно", async () => {
    const { ctx } = setup("2500");
    expect(await belowMinimum(ctx, { total: 1000, currency: "KZT" })).toEqual({
      min: 2500,
      shortfall: 1500,
      currency: "KZT",
    });
    expect(await belowMinimum(ctx, { total: 2499.5, currency: "KZT" })).toMatchObject({
      shortfall: 1,
    });
    expect(await belowMinimum(ctx, { total: 2500, currency: "KZT" })).toBeNull();
    expect(await belowMinimum(ctx, { total: 9000, currency: "KZT" })).toBeNull();
    expect(await belowMinimum(ctx, { total: 0, currency: "KZT" })).toBeNull();
    expect((await belowMinimum(setup(null).ctx, { total: 1, currency: "KZT" })) ?? null).toBeNull();
  });

  it("заказ в другой валюте: минимум переводится по курсу магазина", async () => {
    setFxProvider(async () => ({ USD: 1, KZT: 500, RUB: 80 }));
    const { ctx } = setup("5000", "KZT");
    // 5000 ₸ = 800 ₽
    expect(await belowMinimum(ctx, { total: 500, currency: "RUB" })).toEqual({
      min: 800,
      shortfall: 300,
      currency: "RUB",
    });
    expect(await belowMinimum(ctx, { total: 800, currency: "RUB" })).toBeNull();
  });

  it("курса нет — сравнить нечем, заказ не блокируется", async () => {
    setFxProvider(async () => {
      throw new Error("курс недоступен");
    });
    const { ctx } = setup("5000", "KZT");
    expect(await belowMinimum(ctx, { total: 10, currency: "EUR" })).toBeNull();
  });
});
