import { describe, expect, it } from "vitest";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";
import {
  addonModules,
  effectiveModules,
  missingRequirements,
  nextPeriod,
  overLimit,
  planInvoice,
  planLimits,
  planModules,
  suggestPlan,
  trialWindow,
} from "./plans";
import {
  BASE_MODULES,
  PLAN_MODULES,
  PLAN_NICHES,
  PLAN_TIERS,
  nicheForVertical,
  parsePlan,
  planTitle,
} from "./registry";
import { planUsage, planWriteBlock } from "./tenant";

describe("реестр планов", () => {
  it("в планы попадают только готовые модули", () => {
    for (const n of PLAN_NICHES)
      for (const t of PLAN_TIERS)
        for (const m of PLAN_MODULES[n][t])
          expect(moduleDef(m).status, `${n}.${t}: ${m}`).toBe("available");
  });

  it("каждый план сам закрывает зависимости своих модулей", () => {
    for (const n of PLAN_NICHES)
      for (const t of PLAN_TIERS) {
        const mods = effectiveModules(parsePlan(`${n}.${t}`), undefined)!;
        expect(missingRequirements(mods), `${n}.${t}`).toEqual([]);
      }
  });

  it("уровень выше включает всё из уровня ниже", () => {
    for (const n of PLAN_NICHES) {
      const b = planModules(n, "basic");
      const p = planModules(n, "pro");
      const x = planModules(n, "business");
      for (const m of b) expect(p.has(m)).toBe(true);
      for (const m of p) expect(x.has(m)).toBe(true);
    }
  });

  it("база есть в каждом плане", () => {
    for (const n of PLAN_NICHES)
      for (const m of BASE_MODULES) expect(planModules(n, "basic").has(m)).toBe(true);
  });

  it("особенности ниши: WhatsApp у цветов с Basic, у кондитерской только в Business", () => {
    expect(planModules("flowers", "basic").has("whatsapp")).toBe(true);
    expect(planModules("confectionery", "pro").has("whatsapp")).toBe(false);
    expect(planModules("confectionery", "business").has("whatsapp")).toBe(true);
  });

  it("ключ плана разбирается, чужие значения из v1 — нет", () => {
    expect(parsePlan("flowers.pro")).toEqual({
      kind: "tier",
      key: "flowers.pro",
      niche: "flowers",
      tier: "pro",
    });
    expect(parsePlan("custom")).toEqual({ kind: "custom" });
    expect(parsePlan("premium")).toBeNull();
    expect(parsePlan("consultant.pro")).toBeNull();
    expect(parsePlan(null)).toBeNull();
    expect(planTitle("flowers.pro", "Цветы")).toBe("Цветы · Pro");
  });

  it("BOVI вне тарифов: у ниши consultant планов нет", () => {
    expect(nicheForVertical("consultant")).toBeNull();
    expect(nicheForVertical("consultant_universal")).toBe("consultant_universal");
    expect(nicheForVertical("confectionery")).toBe("confectionery");
  });
});

describe("флаги модулей по плану", () => {
  it("понижение плана выключает то, чего в новом плане нет", () => {
    const m = effectiveModules(parsePlan("confectionery.basic"), undefined)!;
    expect(m.stock).toBe(true);
    expect(m.robokassa).toBe(false);
    expect(m.shop).toBe(true);
  });

  it("надбавка канала и сохранённые модули включаются поверх плана", () => {
    const m = effectiveModules(parsePlan("confectionery.basic"), {
      addons: ["instagram"],
      grandfathered: ["vip"],
    })!;
    expect(m.instagram).toBe(true);
    expect(m.dm_shop).toBe(true);
    expect(m.vip).toBe(true);
    expect(m.robokassa).toBe(false);
  });

  it("консультанту надбавка канала не включает магазин в канале", () => {
    expect(addonModules("consultant_universal", { addons: ["whatsapp"] })).toEqual(["whatsapp"]);
    expect(addonModules("flowers", { addons: ["instagram"] })).toEqual(["instagram", "dm_shop"]);
  });

  it("custom и клиент без плана — модули не трогаем", () => {
    expect(effectiveModules(parsePlan("custom"), undefined)).toBeNull();
    expect(effectiveModules(null, undefined)).toBeNull();
  });

  it("набор полный: каждый ключ реестра явно true или false", () => {
    const m = effectiveModules(parsePlan("digital.pro"), undefined)!;
    expect(Object.keys(m).sort()).toEqual([...MODULE_KEYS].sort());
  });
});

describe("лимиты ИИ", () => {
  it("по уровню плана: диалоги 300/1500/5000, чеки 200/1000/без лимита", () => {
    expect(planLimits(parsePlan("flowers.basic"), undefined)).toEqual({
      aiDialogs: 300,
      receiptChecks: 200,
    });
    expect(planLimits(parsePlan("flowers.pro"), undefined)).toEqual({
      aiDialogs: 1500,
      receiptChecks: 1000,
    });
    expect(planLimits(parsePlan("flowers.business"), undefined)).toEqual({
      aiDialogs: 5000,
      receiptChecks: null,
    });
  });

  it("индивидуальный лимит важнее плана, null — снять лимит", () => {
    expect(
      planLimits(parsePlan("digital.basic"), {
        ai_quota: { receipt_checks: null, ai_dialogs: 50 },
      }),
    ).toEqual({ aiDialogs: 50, receiptChecks: null });
  });

  it("без плана и по договору лимитов нет", () => {
    expect(planLimits(null, undefined)).toBeNull();
    expect(planLimits(parsePlan("custom"), undefined)).toBeNull();
  });

  it("исчерпан при used >= limit, null — никогда", () => {
    expect(overLimit(199, 200)).toBe(false);
    expect(overLimit(200, 200)).toBe(true);
    expect(overLimit(99999, null)).toBe(false);
  });
});

describe("счёт по плану", () => {
  it("месяц без подключения", () => {
    expect(planInvoice("pro", { period: "month", withConnection: false }).amount).toBe(19_900);
  });

  it("первый счёт: месяц + подключение", () => {
    const r = planInvoice("basic", { period: "month", withConnection: true });
    expect(r.amount).toBe(9_900 + 15_000);
    expect(r.note).toContain("Подключение Basic: 15000 ₸");
  });

  it("год — 10 месяцев вместо 12", () => {
    expect(planInvoice("business", { period: "year", withConnection: false }).amount).toBe(399_000);
  });

  it("надбавка канала умножается на число месяцев", () => {
    const r = planInvoice("pro", {
      period: "year",
      withConnection: false,
      addons: [{ title: "Instagram", monthly: 5_000 }],
    });
    expect(r.amount).toBe(199_000 + 50_000);
  });
});

describe("периоды", () => {
  it("продление продолжает подписку без разрыва", () => {
    expect(nextPeriod("2026-10-05T00:00:00Z", "month", "2026-09-26")).toEqual({
      start: "2026-10-06",
      end: "2026-11-05",
    });
  });

  it("истекшая подписка начинается сегодня", () => {
    expect(nextPeriod("2026-09-01", "month", "2026-09-26")).toEqual({
      start: "2026-09-26",
      end: "2026-10-25",
    });
    expect(nextPeriod(null, "year", "2026-09-26")).toEqual({
      start: "2026-09-26",
      end: "2027-09-25",
    });
  });

  it("31 января + месяц не перепрыгивает через февраль", () => {
    expect(nextPeriod(null, "month", "2027-01-31").end).toBe("2027-02-27");
  });

  it("пробный период — 14 дней", () => {
    expect(trialWindow("2026-09-26")).toEqual({ until: "2026-10-10" });
  });
});

describe("подбор плана действующему клиенту", () => {
  it("кондитерская с остатками — Basic, ничего не сохраняем", () => {
    expect(suggestPlan("confectionery", { shop: true, stock: true })).toMatchObject({
      tier: "basic",
      grandfathered: [],
    });
  });

  it("кондитерская с Robokassa и промокодами — Pro", () => {
    expect(
      suggestPlan("confectionery", { shop: true, stock: true, robokassa: true, coupons: true }),
    ).toMatchObject({ tier: "pro", grandfathered: [] });
  });

  it("один модуль из Business не тянет весь Business — он сохраняется бесплатно", () => {
    const r = suggestPlan("confectionery", {
      stock: true,
      robokassa: true,
      coupons: true,
      receipt_ocr: true,
      loyalty: true,
    });
    expect(r.tier).toBe("pro");
    expect(r.grandfathered).toEqual(["loyalty"]);
  });

  it("много модулей Business при одном из Pro — всё равно Business", () => {
    expect(
      suggestPlan("confectionery", {
        robokassa: true,
        loyalty: true,
        referral: true,
        smart_search: true,
      }).tier,
    ).toBe("business");
  });

  it("модуль, которого нет ни в одном плане ниши, сохраняется", () => {
    const r = suggestPlan("digital", { vip: true, robokassa: true, winback: true });
    expect(r.tier).toBe("pro");
    expect(r.grandfathered).toEqual(["winback"]);
  });

  it("с подобранным планом и сохранёнными модулями клиент ничего не теряет", () => {
    const on = { stock: true, robokassa: true, instagram: true, dm_shop: true, funnel: true };
    const r = suggestPlan("flowers", on);
    const mods = effectiveModules(parsePlan(`flowers.${r.tier}`), {
      grandfathered: r.grandfathered,
    })!;
    for (const [k, v] of Object.entries(on))
      if (v) expect(mods[k as keyof typeof mods], k).toBe(true);
  });
});

describe("расход ИИ за месяц", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const tenant = { plan: "flowers.basic", settings: {} };

  it("берёт счётчики текущего месяца и лимиты плана", () => {
    expect(
      planUsage(
        tenant,
        {
          receipt_ocr_usage: JSON.stringify({ count: 900, month: "2026-09", monthCount: 150 }),
          consultant_dialogs_month: JSON.stringify({ month: "2026-09", count: 42 }),
        },
        now,
      ),
    ).toEqual({
      month: "2026-09",
      aiDialogs: 42,
      receiptChecks: 150,
      limits: { aiDialogs: 300, receiptChecks: 200 },
    });
  });

  it("прошлый месяц и мусор — ноль", () => {
    const u = planUsage(
      tenant,
      {
        receipt_ocr_usage: JSON.stringify({ month: "2026-08", monthCount: 150 }),
        consultant_dialogs_month: "{oops",
      },
      now,
    );
    expect(u.receiptChecks).toBe(0);
    expect(u.aiDialogs).toBe(0);
  });
});

describe("клиенты прежней платформы", () => {
  it("план меняется только у клиента, переехавшего на v2", () => {
    expect(planWriteBlock({ settings: {} })).toMatch(/после переезда/);
    expect(planWriteBlock({ settings: { served_by: "v1" } })).toMatch(/после переезда/);
    expect(planWriteBlock({ settings: { served_by: "v2" } })).toBeNull();
  });
});
