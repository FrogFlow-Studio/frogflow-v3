import { describe, expect, it } from "vitest";
import { ADMIN_LOCALE_LABELS, adminT, intlLocale } from "./admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("словарь админки", () => {
  it("переводит с подстановкой, а без перевода откатывается на русский", () => {
    expect(adminT("kk")("nav.orders")).toBe("Тапсырыстар");
    expect(adminT("en")("overview.stepsOf", { done: 2, total: 6 })).toBe("2 of 6");
    expect(adminT("uz")("order.title", { no: 15 })).toBe("Buyurtma #15");
    expect(adminT("ru")("products.count", { n: 3 })).toBe("3 позиций");
  });
  it("каждый язык знает названия и код Intl", () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(ADMIN_LOCALE_LABELS[l]).toBeTruthy();
      expect(() => new Intl.DateTimeFormat(intlLocale(l))).not.toThrow();
      expect(adminT(l)("nav.logout")).not.toBe("nav.logout");
    }
  });
});
