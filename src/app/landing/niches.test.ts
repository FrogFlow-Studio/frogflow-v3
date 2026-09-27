import { describe, expect, it } from "vitest";
import { LANDING_KEYS, landingT } from "@/app/i18n/landing";
import {
  COURSES_FROM_TIER,
  COURSES_SALE,
  MONTHLY_PRICE,
  CONNECTION_PRICE,
  PLAN_TIERS,
  TRIAL_TIER,
} from "@/core/plans/registry";
import { PLAN_PRICES, SETUP_FEE_FROM, planFeatureKeys } from "./config";
import {
  NICHE_PAGES,
  NICHE_PRICING,
  coursesFromTier,
  isNichePage,
  landingSitemapLocs,
  nichePageOpen,
  nichePageUrl,
  openNichePages,
  trialCoversNiche,
} from "./niches";

describe("страницы ниш", () => {
  it("адреса: русский без параметра, остальные с ?lang", () => {
    expect(nichePageUrl("cakes", "ru")).toBe("https://www.frogflow.tech/for/cakes");
    expect(nichePageUrl("courses", "kk")).toBe("https://www.frogflow.tech/for/courses?lang=kk");
  });

  it("неизвестная ниша не страница", () => {
    expect(isNichePage("cakes")).toBe(true);
    expect(isNichePage("flowers")).toBe(false);
    expect(isNichePage("__proto__")).toBe(false);
  });

  it("у каждой страницы есть все тексты на всех языках, и заголовки у страниц разные", () => {
    const parts = ["link", "title", "description", "h1", "lead"];
    for (const i of [1, 2, 3, 4]) parts.push(`f${i}.title`, `f${i}.text`);
    for (const s of ["b1", "b2", "b3", "a1", "a2", "a3"]) parts.push(s);
    for (const p of NICHE_PAGES)
      for (const part of parts) expect(LANDING_KEYS).toContain(`niche.${p}.${part}`);
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const t = landingT(l);
      const titles = NICHE_PAGES.map((p) => t(`niche.${p}.title` as never));
      expect(new Set(titles).size, l).toBe(NICHE_PAGES.length);
      expect(titles).not.toContain(t("meta.title"));
    }
  });

  it("цены главной и страниц ниш — из реестра планов", () => {
    expect(PLAN_PRICES).toEqual(MONTHLY_PRICE);
    expect(SETUP_FEE_FROM).toBe(CONNECTION_PRICE.basic);
  });

  it("страница курсов следует реестру: есть, только пока курсы входят в план, и с того же тарифа", () => {
    const inPlan = COURSES_SALE === "plan";
    expect(nichePageOpen("courses")).toBe(inPlan);
    expect(coursesFromTier()).toBe(inPlan ? COURSES_FROM_TIER : null);
    if (inPlan)
      expect(planFeatureKeys(NICHE_PRICING.courses, COURSES_FROM_TIER)).toContain(
        "pricing.courses",
      );
    expect(openNichePages()).toEqual(
      inPlan ? ["cakes", "materials", "courses"] : ["cakes", "materials"],
    );
  });

  it("пробный период обещан, только если его тариф даёт то, что продаёт страница", () => {
    expect(trialCoversNiche("cakes")).toBe(true);
    expect(trialCoversNiche("materials")).toBe(true);
    const from = coursesFromTier();
    expect(trialCoversNiche("courses")).toBe(
      from !== null && PLAN_TIERS.indexOf(from) <= PLAN_TIERS.indexOf(TRIAL_TIER),
    );
    // Сейчас курсы с Pro, пробный период — Basic: на странице курсов его нет.
    if (COURSES_FROM_TIER !== TRIAL_TIER) expect(trialCoversNiche("courses")).toBe(false);
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(landingT(l)("niche.courses.description")).not.toMatch(/\{days\}|7/);
  });

  it("карта сайта платформы: главная и открытые страницы ниш на всех языках", () => {
    const locs = landingSitemapLocs();
    expect(locs).toContain("https://www.frogflow.tech/");
    expect(locs).toContain("https://www.frogflow.tech/?lang=kk");
    expect(locs).toContain("https://www.frogflow.tech/for/cakes?lang=uz");
    expect(locs).toHaveLength(4 + openNichePages().length * 4);
    expect(new Set(locs).size).toBe(locs.length);
  });
});
