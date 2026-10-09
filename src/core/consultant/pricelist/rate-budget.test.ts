import { describe, expect, it } from "vitest";
import { budgetKzt } from "./tools";
import { priceRub, rubToKzt } from "./rate";

describe("бюджет покупателя в рублях (BOVI 04.10)", () => {
  const WEEKDAY = new Date("2026-10-07T06:00:00Z");

  it("рубли → тенге по формуле магазина: позиция на границе показывается ровно в бюджет", () => {
    const kzt = rubToKzt(80000, 4.36, WEEKDAY);
    expect(kzt).toBe(Math.round(80000 * 4.36 * 0.95));
    expect(priceRub(kzt, 4.36, WEEKDAY)).toBe(80000);
  });

  it("рублёвый бюджет важнее тенгового; без курса — без отбора, а не «80 000 ₸»", () => {
    expect(budgetKzt({ max_price_rub: 80000, max_price_kzt: 80000 }, 4.36)).toBeGreaterThan(300000);
    expect(budgetKzt({ max_price_rub: 80000 }, null)).toBeUndefined();
    expect(budgetKzt({ max_price_kzt: 80000 }, 4.36)).toBe(80000);
    expect(budgetKzt({}, 4.36)).toBeUndefined();
  });
});
