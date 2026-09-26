import { describe, expect, it } from "vitest";
import {
  CONSULTANT_LIMITS,
  CONSULTANT_LIMIT_MAX,
  addDaily,
  budgetBlock,
  limitsFor,
  parseDaily,
  parseMonthly,
  reserveDaily,
  RESERVE_USD,
  settleDaily,
  startsNewDialog,
} from "./budget";

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

describe("ИИ-диалоги за месяц", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");

  it("новый диалог — первый ответ или пауза дольше суток", () => {
    expect(startsNewDialog(undefined, now)).toBe(true);
    expect(startsNewDialog("2026-09-26T09:00:00Z", now)).toBe(false);
    expect(startsNewDialog("2026-09-25T11:59:00Z", now)).toBe(true);
    expect(startsNewDialog("мусор", now)).toBe(true);
  });

  it("счётчик месяца сбрасывается в новом месяце и не ломается на мусоре", () => {
    expect(parseMonthly(JSON.stringify({ month: "2026-09", count: 12 }), "2026-09")).toEqual({
      month: "2026-09",
      count: 12,
    });
    expect(parseMonthly(JSON.stringify({ month: "2026-08", count: 12 }), "2026-09").count).toBe(0);
    expect(parseMonthly("{oops", "2026-09").count).toBe(0);
  });
});

describe("свой предел клиента (bots.settings.consultant_limits)", () => {
  it("без настройки — общий предел платформы", () => {
    expect(limitsFor(undefined)).toEqual(CONSULTANT_LIMITS);
    expect(limitsFor({})).toEqual(CONSULTANT_LIMITS);
  });

  it("клиенту с большим потоком предел поднимается, незаданное остаётся общим", () => {
    const l = limitsFor({ daily_usd: 40, daily_calls: null });
    expect(l).toEqual({ ...CONSULTANT_LIMITS, dailyUsd: 40 });
    const b = { date: D, usd: 10, calls: 0, tests: 0 };
    expect(budgetBlock(b, "customer")).toMatch(/\$5\)/);
    expect(budgetBlock(b, "customer", l)).toBeNull();
    expect(budgetBlock({ ...b, usd: 40 }, "customer", l)).toMatch(/\$40\)/);
  });

  it("мусор и запредельные числа не отключают защиту", () => {
    expect(
      limitsFor({ daily_usd: -1, daily_calls: Number.NaN, daily_tests: "5" as never }),
    ).toEqual(CONSULTANT_LIMITS);
    expect(limitsFor({ daily_usd: 1e9 }).dailyUsd).toBe(CONSULTANT_LIMIT_MAX.dailyUsd);
    expect(limitsFor({ daily_calls: 12.7 }).dailyCalls).toBe(12);
  });

  it("ноль — ИИ клиенту выключен", () => {
    const l = limitsFor({ daily_usd: 0 });
    expect(budgetBlock(parseDaily(null, D), "customer", l)).toMatch(/предел расходов/);
  });
});

describe("бронь бюджета на вызов модели", () => {
  const D = "2026-09-26";
  it("бронь прибавляет запас к расходу и считает вызов; у исчерпанного — причина", () => {
    const r = reserveDaily({ date: D, usd: 1, calls: 3, tests: 0 }, "customer");
    expect(r).toEqual({ next: { date: D, usd: 1 + RESERVE_USD, calls: 4, tests: 0 } });
    expect(reserveDaily({ date: D, usd: 5, calls: 0, tests: 0 }, "customer")).toHaveProperty(
      "blocked",
    );
  });

  it("после ответа бронь меняется на настоящую цену и не уходит в минус", () => {
    expect(settleDaily({ date: D, usd: 1.03, calls: 1, tests: 0 }, 0.03, 0.002).usd).toBe(1.002);
    expect(settleDaily({ date: D, usd: 0.01, calls: 0, tests: 0 }, 0.03, 0).usd).toBe(0);
  });
});
