import { describe, expect, it } from "vitest";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";
import {
  addonModules,
  effectiveModules,
  keptModules,
  missingRequirements,
  nextPeriod,
  overLimit,
  planInvoice,
  planLimits,
  planModules,
  suggestPlan,
  trialExtension,
  trialWindow,
} from "./plans";
import {
  ADDON_KEYS,
  COURSES_SALE,
  CUSTOM_PLAN,
  DB_PLAN_VALUES,
  dbPlanFor,
  planKey,
  ADDON_MONTHLY_PRICE,
  BASE_MODULES,
  PLAN_MODULES,
  PLAN_NICHES,
  PLAN_TIERS,
  nicheForVertical,
  parsePlan,
  planTitle,
} from "./registry";
import { planUsage, planWriteBlock, upgradeHint, type PlanUsage } from "./tenant";

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

  it("пробный период — 7 дней, считая день начала", () => {
    expect(trialWindow("2026-09-26")).toEqual({ until: "2026-10-02" });
  });

  it("продление пробного — вплотную к текущему сроку", () => {
    expect(trialExtension("2026-10-02", 7, "2026-09-30")).toEqual({
      start: "2026-10-03",
      end: "2026-10-09",
    });
  });

  it("продление кончившегося пробного — с сегодняшнего дня", () => {
    expect(trialExtension("2026-10-02", 3, "2026-10-10")).toEqual({
      start: "2026-10-10",
      end: "2026-10-12",
    });
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

describe("надбавки за каналы", () => {
  it("WhatsApp и Instagram — по 5 000 ₸ в месяц, в годовом счёте 10 месяцев", () => {
    for (const a of ADDON_KEYS) expect(ADDON_MONTHLY_PRICE[a]).toBe(5000);
    const inv = planInvoice("basic", {
      period: "year",
      withConnection: false,
      addons: [{ title: "WhatsApp", monthly: ADDON_MONTHLY_PRICE.whatsapp }],
    });
    expect(inv.amount).toBe(9900 * 10 + 5000 * 10);
  });
});

describe("подсказка «предложить план выше»", () => {
  const usage = (
    aiDialogs: number,
    receiptChecks: number,
    limits = { aiDialogs: 300, receiptChecks: 200 as number | null },
  ): PlanUsage => ({
    month: "2026-09",
    aiDialogs,
    receiptChecks,
    limits,
  });

  it("молчит, пока расход меньше 80 %", () => {
    expect(upgradeHint("flowers.basic", usage(239, 159))).toBeNull();
  });

  it("близко к лимиту и исчерпан — следующий план", () => {
    expect(upgradeHint("flowers.basic", usage(240, 10))).toEqual({
      level: "near",
      what: ["aiDialogs"],
      next: "pro",
    });
    expect(
      upgradeHint("flowers.pro", usage(300, 200, { aiDialogs: 1500, receiptChecks: 200 })),
    ).toEqual({
      level: "over",
      what: ["receiptChecks"],
      next: "business",
    });
  });

  it("на Business следующего плана нет; без плана и без лимита — молчит", () => {
    expect(
      upgradeHint("flowers.business", usage(5000, 0, { aiDialogs: 5000, receiptChecks: null }))
        ?.next,
    ).toBeNull();
    expect(upgradeHint(null, usage(9999, 9999))).toBeNull();
    expect(upgradeHint("custom", usage(9999, 9999))).toBeNull();
    expect(
      upgradeHint("flowers.basic", usage(5, 5, { aiDialogs: 0, receiptChecks: null })),
    ).toBeNull();
  });
});

describe("колонка bots.subscription_plan", () => {
  // В рабочей базе CHECK пропускает только free/basic/pro/enterprise:
  // «flowers.pro» или «custom» база отклоняет, ключ плана живёт в settings.
  it("для любого плана пишется значение, которое принимает база", () => {
    const keys = [CUSTOM_PLAN, ...PLAN_NICHES.flatMap((n) => PLAN_TIERS.map((t) => planKey(n, t)))];
    for (const k of keys) expect(DB_PLAN_VALUES).toContain(dbPlanFor(k));
  });

  it("уровень переносится как есть, Business и индивидуальный — enterprise", () => {
    expect(dbPlanFor("flowers.basic")).toBe("basic");
    expect(dbPlanFor("digital.pro")).toBe("pro");
    expect(dbPlanFor("confectionery.business")).toBe("enterprise");
    expect(dbPlanFor(CUSTOM_PLAN)).toBe("enterprise");
  });
});

describe("модуль «Курсы» в тарифах", () => {
  it("по умолчанию входит в Pro и Business ниш с магазином, не в Basic и не консультанту", () => {
    for (const n of ["digital", "confectionery", "flowers"] as const) {
      expect(planModules(n, "basic", "plan").has("courses")).toBe(false);
      expect(planModules(n, "pro", "plan").has("courses")).toBe(true);
      expect(planModules(n, "business", "plan").has("courses")).toBe(true);
    }
    for (const t of PLAN_TIERS)
      expect(planModules("consultant_universal", t, "plan").has("courses")).toBe(false);
  });

  it("«отдельно» — ни в одном плане, но подключённый оператором сохраняется", () => {
    for (const n of PLAN_NICHES)
      for (const t of PLAN_TIERS) expect(planModules(n, t, "separate").has("courses")).toBe(false);
  });

  it("«отложить» — выключен у всех, даже подключённый вручную", () => {
    const mods = effectiveModules(
      parsePlan("digital.business"),
      { grandfathered: ["courses"] },
      "off",
    );
    expect(mods!.courses).toBe(false);
  });

  it("решение Якова: входит в Pro+ — модуль готов, Pro и Business открывают, Basic нет", () => {
    expect(COURSES_SALE).toBe("plan");
    expect(moduleDef("courses").status).toBe("available");
    for (const n of ["digital", "confectionery", "flowers"] as const) {
      expect(effectiveModules(parsePlan(`${n}.basic`), undefined)!.courses).toBe(false);
      expect(effectiveModules(parsePlan(`${n}.pro`), undefined)!.courses).toBe(true);
      expect(effectiveModules(parsePlan(`${n}.business`), undefined)!.courses).toBe(true);
    }
    expect(effectiveModules(parsePlan("consultant_universal.business"), undefined)!.courses).toBe(
      false,
    );
  });
});

describe("купленное сверх плана не пропадает при назначении плана", () => {
  const on = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));

  it("первый план (переезд, выбор оператора): всё включённое вне плана — в сохранённые", () => {
    const kept = keptModules(null, undefined, on("shop", "instagram", "wa_shop", "referral"));
    expect(kept).toEqual(expect.arrayContaining(["instagram", "wa_shop", "referral"]));
    // Базовые модули и так в каждом плане.
    expect(kept).not.toContain("shop");
  });

  it("смена плана: модули прежнего плана и надбавок не переносятся, купленные — да", () => {
    const prev = parsePlan("digital.pro");
    const proOnly = [...planModules("digital", "pro")].find(
      (k) => !planModules("digital", "basic").has(k),
    )!;
    const kept = keptModules(
      prev,
      { addons: ["whatsapp"], grandfathered: ["telegram_stars"] },
      on("shop", proOnly, "whatsapp", "instagram"),
    );
    expect(kept).toContain("instagram");
    expect(kept).toContain("telegram_stars");
    expect(kept).not.toContain(proOnly);
    expect(kept).not.toContain("whatsapp");
  });

  it("переезд: любой первый план оставляет включённым всё, что было у клиента на v1", () => {
    // Клиент v1 со всеми готовыми модулями — худший случай для «купленное не пропадает».
    const v1 = Object.fromEntries(
      MODULE_KEYS.filter((k) => moduleDef(k).status === "available").map((k) => [k, true]),
    );
    const grandfathered = keptModules(null, undefined, v1);
    for (const n of PLAN_NICHES)
      for (const tier of PLAN_TIERS) {
        const mods = effectiveModules(parsePlan(`${n}.${tier}`), { grandfathered })!;
        const lost = Object.keys(v1).filter((k) => !mods[k as keyof typeof mods]);
        expect(lost, `${n}.${tier}`).toEqual([]);
      }
  });

  it("модуль «в разработке» в сохранённые не попадает", () => {
    expect(keptModules(null, undefined, on("courier"))).toEqual([]);
  });
});

describe("модуль «Несколько ботов» в тарифах", () => {
  it("по умолчанию входит в Business всех ниш, не в Basic и Pro", () => {
    for (const n of PLAN_NICHES) {
      expect(planModules(n, "basic").has("multi_bot")).toBe(false);
      expect(planModules(n, "pro").has("multi_bot")).toBe(false);
      expect(planModules(n, "business").has("multi_bot")).toBe(true);
      expect(effectiveModules(parsePlan(`${n}.business`), undefined)!.multi_bot).toBe(true);
    }
  });

  it("клиент на Pro, которому модуль оставлен сверх плана, его сохраняет", () => {
    const mods = effectiveModules(parsePlan("digital.pro"), { grandfathered: ["multi_bot"] });
    expect(mods!.multi_bot).toBe(true);
    expect(effectiveModules(parsePlan("digital.pro"), undefined)!.multi_bot).toBe(false);
  });
});

describe("воронка сделок в тарифах", () => {
  it("входит в Pro и Business всех ниш, в Basic — нет (подключается отдельно)", () => {
    expect(moduleDef("crm_pipeline").status).toBe("available");
    for (const niche of ["confectionery", "flowers", "digital", "consultant_universal"] as const) {
      expect(planModules(niche, "pro")).toContain("crm_pipeline");
      expect(planModules(niche, "business")).toContain("crm_pipeline");
      expect(planModules(niche, "basic")).not.toContain("crm_pipeline");
    }
  });
});
