import { describe, expect, it } from "vitest";
import { MONTHLY_PRICE } from "@/core/plans/registry";
import { monthlyCost, tierAdvice } from "./advice";

/** Подсказка «выгоднее тариф X»: точки выводятся из ставок и цен, а не заданы числами. */
describe("стоимость месяца: подписка плюс комиссия", () => {
  it("до порога — только подписка; сверх порога — процент тарифа", () => {
    expect(monthlyCost("basic", 40_000)).toBe(MONTHLY_PRICE.basic);
    expect(monthlyCost("basic", 150_000)).toBe(9_900 + 10_000);
    expect(monthlyCost("pro", 150_000)).toBe(19_900 + 5_000);
    expect(monthlyCost("business", 150_000)).toBe(39_900 + 1_000);
  });
});

describe("точки перехода: 200 000 и 500 000 ₸ сверх порога, то есть 250 000 и 550 000 ₸ продаж", () => {
  it("Базовый → Про: на самой точке цены равны — подсказки нет, на рубль выше — есть", () => {
    expect(monthlyCost("basic", 250_000)).toBe(monthlyCost("pro", 250_000));
    expect(tierAdvice("basic", 250_000)).toBeNull();
    expect(tierAdvice("basic", 260_000)).toMatchObject({ tier: "pro" });
    expect(tierAdvice("basic", 240_000)).toBeNull();
  });
  it("Про → Бизнес: на 550 000 равны, выше — Бизнес", () => {
    expect(monthlyCost("pro", 550_000)).toBe(monthlyCost("business", 550_000));
    expect(tierAdvice("pro", 550_000)).toBeNull();
    expect(tierAdvice("pro", 600_000)).toMatchObject({ tier: "business" });
  });
  it("с Базового сразу на Бизнес, если он дешевле Про", () => {
    expect(tierAdvice("basic", 1_000_000)).toMatchObject({ tier: "business" });
  });
  it("дешевле нынешнего нет — молчим; малые продажи на Бизнесе — советуем меньший", () => {
    expect(tierAdvice("business", 1_000_000)).toBeNull();
    expect(tierAdvice("pro", 100_000)).toMatchObject({ tier: "basic" });
    expect(tierAdvice("business", 0)).toMatchObject({ tier: "basic" });
  });
  it("разница названа точно", () => {
    const a = tierAdvice("basic", 450_000)!;
    expect(a).toMatchObject({ tier: "pro", currentCost: 49_900, cost: 39_900, saving: 10_000 });
  });
});
