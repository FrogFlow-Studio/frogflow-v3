import { describe, expect, it } from "vitest";
import { BILLING_ADDONS } from "@/core/tenant/types";
import {
  availableAddons,
  billableAddons,
  effectiveModules,
  planLimits,
  planModules,
} from "./plans";
import {
  ADDONS,
  ADDON_KEYS,
  ADDON_MONTHLY_PRICE,
  MONTHLY_PRICE,
  PLAN_NICHES,
  PLAN_TIERS,
  PLAN_VERSION,
  TRIAL_TIER,
  parsePlan,
  tierLimits,
  type PlanNiche,
} from "./registry";

/**
 * Сетка версии 2 (решение Якова 10.10.2026): Basic продаёт, Pro делает всё
 * сам, Business — все каналы и команда. Лимиты ИИ — по себестоимости.
 */
const SHOP_NICHES: PlanNiche[] = ["digital", "courses", "confectionery", "flowers"];
/** Себестоимость диалога консультанта по базе BOVI: ≈ $0,105 ≈ 55 ₸. */
const DIALOG_COST_KZT = 55;

describe("сетка тарифов, версия 2", () => {
  it("версия плана поднята", () => {
    expect(PLAN_VERSION).toBe(2);
  });

  it("проверка чека Kaspi — с Basic в каждой нише с магазином", () => {
    for (const n of SHOP_NICHES) expect(planModules(n, "basic").has("receipt_ocr"), n).toBe(true);
  });

  it("Продамус и Instagram — с Pro, на Basic их нет", () => {
    for (const n of SHOP_NICHES) {
      for (const m of ["prodamus", "instagram", "dm_shop"] as const) {
        expect(planModules(n, "basic").has(m), `${n} basic ${m}`).toBe(false);
        expect(planModules(n, "pro").has(m), `${n} pro ${m}`).toBe(true);
      }
    }
  });

  it("у цифровых товаров Business добавляет валюты и роли команды", () => {
    const biz = planModules("digital", "business");
    expect(biz.has("multi_currency")).toBe(true);
    expect(biz.has("admin_roles")).toBe(true);
    expect(planModules("digital", "pro").has("admin_roles")).toBe(false);
  });

  it("каждый уровень включает всё из младшего", () => {
    for (const n of PLAN_NICHES)
      for (let i = 1; i < PLAN_TIERS.length; i++) {
        const lower = planModules(n, PLAN_TIERS[i - 1]!);
        const upper = planModules(n, PLAN_TIERS[i]!);
        for (const m of lower) expect(upper.has(m), `${n}.${PLAN_TIERS[i]} ${m}`).toBe(true);
      }
  });

  it("пробный период показывает Pro", () => {
    expect(TRIAL_TIER).toBe("pro");
  });
});

describe("лимиты ИИ по себестоимости", () => {
  it("магазин: ИИ на Basic не входит, Pro 100, Business 250", () => {
    expect(tierLimits("digital", "basic").aiDialogs).toBe(0);
    expect(tierLimits("digital", "pro").aiDialogs).toBe(100);
    expect(tierLimits("digital", "business").aiDialogs).toBe(250);
  });

  it("консультант: ИИ — сам продукт, есть с Basic", () => {
    expect(tierLimits("consultant_universal", "basic").aiDialogs).toBeGreaterThan(0);
    expect(planLimits(parsePlan("consultant_universal.basic"), undefined)?.aiDialogs).toBe(100);
  });

  it("полностью выбранный лимит не съедает цену тарифа", () => {
    for (const n of PLAN_NICHES)
      for (const t of PLAN_TIERS) {
        const d = tierLimits(n, t).aiDialogs;
        expect(d, `${n}.${t}: ИИ без лимита — убыток`).not.toBeNull();
        expect(d! * DIALOG_COST_KZT, `${n}.${t}`).toBeLessThan(MONTHLY_PRICE[t] * 0.6);
      }
  });

  it("пакет диалогов окупается", () => {
    expect(ADDONS.ai_pack.aiDialogs * DIALOG_COST_KZT).toBeLessThan(ADDON_MONTHLY_PRICE.ai_pack);
  });

  it("пакет диалогов прибавляется к лимиту плана, индивидуальный лимит оператора важнее", () => {
    const pro = parsePlan("digital.pro");
    expect(planLimits(pro, { addons: ["ai_pack"] })?.aiDialogs).toBe(300);
    expect(planLimits(parsePlan("digital.basic"), { addons: ["ai_pack"] })?.aiDialogs).toBe(200);
    expect(planLimits(pro, { addons: ["ai_pack"], ai_quota: { ai_dialogs: 50 } })?.aiDialogs).toBe(
      50,
    );
  });
});

describe("надбавки", () => {
  it("ключи надбавок в настройках клиента совпадают с реестром", () => {
    expect([...BILLING_ADDONS].sort()).toEqual([...ADDON_KEYS].sort());
  });

  it("VIP-клуб к Basic — только у цифровых товаров и за 5 000 ₸", () => {
    expect(availableAddons("digital", "basic")).toContain("vip");
    expect(availableAddons("confectionery", "basic")).not.toContain("vip");
    expect(ADDON_MONTHLY_PRICE.vip).toBe(5000);
    const m = effectiveModules(parsePlan("digital.basic"), { addons: ["vip"] })!;
    expect(m.vip).toBe(true);
    // В нише, где VIP не продаётся, надбавка модуль не включает.
    expect(effectiveModules(parsePlan("flowers.basic"), { addons: ["vip"] })!.vip).toBe(false);
  });

  it("Basic с двумя надбавками стоит как Pro — стимул перейти на Pro", () => {
    const basicPlus = MONTHLY_PRICE.basic + ADDON_MONTHLY_PRICE.vip + ADDON_MONTHLY_PRICE.instagram;
    expect(basicPlus).toBeGreaterThanOrEqual(MONTHLY_PRICE.pro - 100);
  });

  it("надбавка, которая уже в плане, не предлагается и в счёт не идёт", () => {
    expect(availableAddons("digital", "pro")).not.toContain("instagram");
    expect(availableAddons("digital", "pro")).not.toContain("vip");
    expect(availableAddons("digital", "pro")).toContain("whatsapp");
    expect(availableAddons("digital", "business")).toEqual(["ai_pack"]);
    expect(billableAddons("digital", "pro", ["instagram", "whatsapp", "vip"])).toEqual([
      "whatsapp",
    ]);
  });
});
