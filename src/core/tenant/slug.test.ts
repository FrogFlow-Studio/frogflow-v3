import { describe, expect, it } from "vitest";
import { SHOP_SLUG_PATTERN, SHOP_SLUG_RE, isReservedSlug, isShopSlug } from "./slug";

describe("короткий адрес магазина", () => {
  it("принимает «_» и «.», как регистрация и витрина", () => {
    for (const s of ["ab", "printkzart", "anna_shop", "shop.kz", "my-shop-2", "a1"])
      expect(isShopSlug(s), s).toBe(true);
  });

  it("не принимает заглавные, пробелы, знак в начале и слишком длинное", () => {
    for (const s of ["A-shop", "a b", "_shop", ".shop", "-shop", "a", "a".repeat(41), "магазин"])
      expect(isShopSlug(s), s).toBe(false);
  });

  it("pattern у input — то же правило, что в коде", () => {
    const html = new RegExp(`^(?:${SHOP_SLUG_PATTERN})$`, "v");
    for (const s of ["anna_shop", "shop.kz", "_shop", "A", "my-shop"])
      expect(html.test(s), s).toBe(SHOP_SLUG_RE.test(s));
  });
});

describe("служебные адреса", () => {
  it("служебные слова и «frogflow» заняты в любом написании", () => {
    for (const s of [
      "admin",
      "AD-min",
      "a.d.m.i.n",
      "api",
      "operator",
      "kaspi",
      "frogflow-shop",
      "my_frogflow",
    ])
      expect(isReservedSlug(s), s).toBe(true);
  });

  it("обычные имена магазинов свободны", () => {
    for (const s of ["anna_shop", "printkzart", "didaktika_03", "shop.kz", "", null, undefined])
      expect(isReservedSlug(s), String(s)).toBe(false);
  });
});
