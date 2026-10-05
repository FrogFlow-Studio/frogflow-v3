import { describe, expect, it } from "vitest";
import type { FunnelRow } from "./funnel";
import { growthFunnel } from "./growth-funnel";

const row = (
  channel: string,
  arrived: number,
  cart: number,
  ordered: number,
  paid: number,
): FunnelRow => ({
  channel,
  arrived,
  cart,
  ordered,
  paid,
});

describe("воронка роста (У2)", () => {
  const rows = [
    row("all", 100, 40, 20, 10),
    row("web", 50, 20, 8, 4),
    row("telegram", 50, 20, 12, 6),
  ];

  it("без визитов — прежняя воронка по всем каналам, с долями от прошлого шага", () => {
    const f = growthFunnel(rows, null);
    expect(f).toEqual({
      empty: false,
      mode: "all",
      stages: [
        { key: "arrived", value: 100, rate: null },
        { key: "cart", value: 40, rate: 40 },
        { key: "ordered", value: 20, rate: 50 },
        { key: "paid", value: 10, rate: 50 },
      ],
    });
  });

  it("с визитами — воронка сайта: визит, товар, корзина, заказ, оплата только из канала «сайт»", () => {
    const f = growthFunnel(rows, { visit: 400, product: 120 });
    expect(f).toMatchObject({ empty: false, mode: "site" });
    if (f.empty) throw new Error("пусто");
    expect(f.stages.map((s) => [s.key, s.value, s.rate])).toEqual([
      ["visit", 400, null],
      ["product", 120, 30],
      ["cart", 20, 17],
      ["ordered", 8, 40],
      ["paid", 4, 50],
    ]);
  });

  it("нулевые визиты — как будто счётчика нет, воронка не обнуляется", () => {
    expect(growthFunnel(rows, { visit: 0, product: 0 })).toMatchObject({ mode: "all" });
  });

  it("пустой период — «нет данных», а не ряд нулей; шаг больше прошлого — без доли", () => {
    expect(growthFunnel([row("all", 0, 0, 0, 0)], null)).toEqual({ empty: true });
    expect(growthFunnel([], null)).toEqual({ empty: true });
    const f = growthFunnel([row("all", 2, 5, 1, 1)], null);
    if (f.empty) throw new Error("пусто");
    expect(f.stages[1]!.rate).toBeNull();
  });
});
