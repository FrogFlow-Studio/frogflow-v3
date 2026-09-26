import { describe, expect, it } from "vitest";
import { LANDING_KEYS, landingT } from "./landing";
import { formatTenge } from "@/app/landing/config";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("словарь главной", () => {
  it("переводит с подстановкой на каждом языке", () => {
    expect(landingT("ru")("hero.ctaSignup", { days: 14 })).toBe("Попробовать 14 дней бесплатно");
    expect(landingT("kk")("pricing.from", { price: "9 900 ₸" })).toBe("9 900 ₸ бастап");
    expect(landingT("en")("nav.pricing")).toBe("Pricing");
    expect(landingT("uz")("pricing.from", { price: "9 900 ₸" })).toBe("9 900 ₸ dan");
  });
  it("ни один ключ не пропущен ни в одном языке", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = landingT(l);
      for (const k of LANDING_KEYS) {
        expect(t(k), `${l}: ${k}`).toBeTruthy();
        expect(t(k), `${l}: ${k}`).not.toBe(k);
      }
    }
  });
  it("пишет тенге с неразрывными пробелами", () => {
    expect(formatTenge(9900)).toBe("9 900 ₸");
    expect(formatTenge(39900)).toBe("39 900 ₸");
    expect(formatTenge(900)).toBe("900 ₸");
  });
});
