import { describe, expect, it } from "vitest";
import { CONSULTANT_LIMITS, addDaily, budgetBlock, parseDaily } from "./budget";

const D = "2026-09-26";

describe("дневной предел консультанта", () => {
  it("новый день начинает счёт заново, мусор не ломает", () => {
    const old = JSON.stringify({ date: "2026-09-25", usd: 99, calls: 5000, tests: 99 });
    expect(parseDaily(old, D)).toEqual({ date: D, usd: 0, calls: 0, tests: 0 });
    expect(parseDaily("{oops", D).usd).toBe(0);
    expect(parseDaily(JSON.stringify({ date: D, usd: "7", calls: -3 }), D)).toEqual({
      date: D,
      usd: 0,
      calls: 0,
      tests: 0,
    });
  });

  it("предел в долларах закрывает и покупателей, и тест-чат", () => {
    const b = { date: D, usd: CONSULTANT_LIMITS.dailyUsd, calls: 0, tests: 0 };
    expect(budgetBlock(b, "customer")).toMatch(/предел расходов/);
    expect(budgetBlock(b, "test")).toMatch(/предел расходов/);
  });

  it("тест-чат считается отдельно от ответов покупателям", () => {
    let b = parseDaily(null, D);
    for (let i = 0; i < CONSULTANT_LIMITS.dailyTests; i++) b = addDaily(b, 0.001, "test");
    expect(budgetBlock(b, "test")).toMatch(/Пробных вопросов/);
    expect(budgetBlock(b, "customer")).toBeNull();
    expect(b.calls).toBe(0);
  });

  it("число ответов покупателям ограничено даже при нулевой цене", () => {
    const b = { date: D, usd: 0, calls: CONSULTANT_LIMITS.dailyCalls, tests: 0 };
    expect(budgetBlock(b, "customer")).toMatch(/ответов/);
    expect(addDaily(parseDaily(null, D), 0.0123, "customer")).toMatchObject({
      usd: 0.0123,
      calls: 1,
    });
  });
});
