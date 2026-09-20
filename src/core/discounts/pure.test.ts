import { describe, expect, it } from "vitest";
import {
  applyDiscounts,
  computeGiftDiscount,
  computePointsDiscount,
  computePointsEarned,
  computePromoDiscount,
  generateGiftCode,
  normalizeCode,
} from "./pure";

describe("discounts", () => {
  it("промокод: процент и фиксированная сумма, не больше суммы", () => {
    expect(computePromoDiscount(1000, { discount_type: "percent", discount_value: 15 })).toBe(150);
    expect(computePromoDiscount(1000, { discount_type: "fixed", discount_value: 300 })).toBe(300);
    expect(computePromoDiscount(200, { discount_type: "fixed", discount_value: 300 })).toBe(200);
    expect(computePromoDiscount(0, { discount_type: "percent", discount_value: 50 })).toBe(0);
    expect(computePromoDiscount(333, { discount_type: "percent", discount_value: 10 })).toBe(33);
  });

  it("сертификат и баллы ограничены суммой", () => {
    expect(computeGiftDiscount(500, 1000)).toBe(500);
    expect(computeGiftDiscount(1500, 1000)).toBe(1000);
    expect(computePointsDiscount(500, 120.7)).toBe(120);
    expect(computePointsDiscount(50, 120)).toBe(50);
    expect(computePointsEarned(1999, 5)).toBe(99);
  });

  it("порядок скидок: промокод → баллы → сертификат, итог не ниже нуля", () => {
    const r = applyDiscounts(1000, {
      promo: { discount_type: "percent", discount_value: 10 },
      points: 300,
      gift: 1000,
    });
    expect(r).toEqual({ promo: 100, points: 300, gift: 600, total: 0 });
    expect(applyDiscounts(1000, {}).total).toBe(1000);
  });

  it("коды нормализуются, сертификат генерируется читаемым", () => {
    expect(normalizeCode("  sale10 ")).toBe("SALE10");
    expect(generateGiftCode()).toMatch(/^GIFT-[A-Z2-9]{8}$/);
  });
});
