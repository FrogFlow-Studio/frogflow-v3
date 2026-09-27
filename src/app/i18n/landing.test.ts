import { describe, expect, it } from "vitest";
import { LANDING_KEYS, landingT } from "./landing";
import { formatTenge, landingUrl, planFeatureKeys } from "@/app/landing/config";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("словарь главной", () => {
  it("переводит с подстановкой на каждом языке", () => {
    expect(landingT("ru")("hero.ctaSignup", { days: 7 })).toBe("Попробовать 7 дней бесплатно");
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

describe("landingUrl", () => {
  it("русский без параметра, остальные с ?lang, всё на новом домене", () => {
    expect(landingUrl("ru")).toBe("https://www.frogflow.tech/");
    expect(landingUrl("kk")).toBe("https://www.frogflow.tech/?lang=kk");
  });
});

describe("тарифы на главной: «Курсы» входят в Pro+", () => {
  it("строка курсов — в Pro ниш с магазином; Business получает её через «Всё из Pro»", () => {
    for (const n of ["dig", "cake", "flow"] as const) {
      expect(planFeatureKeys(n, "basic")).not.toContain("pricing.courses");
      expect(planFeatureKeys(n, "pro")).toContain("pricing.courses");
      expect(planFeatureKeys(n, "business")).toContain("pricing.allPro");
    }
    for (const p of ["basic", "pro", "business"] as const)
      expect(planFeatureKeys("ai", p)).not.toContain("pricing.courses");
    // Всем ключам есть перевод (проверка словаря выше).
    for (const n of ["dig", "cake", "flow", "ai"] as const)
      for (const p of ["basic", "pro", "business"] as const)
        for (const k of planFeatureKeys(n, p)) expect(LANDING_KEYS).toContain(k);
  });
});
