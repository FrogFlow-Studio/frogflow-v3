import { describe, expect, it } from "vitest";
import { CONNECTION_PRICE, MONTHLY_PRICE, PLAN_LIMITS } from "./registry";
import { limitNotices, type PlanUsage } from "./tenant";

const usage = (
  aiDialogs: number,
  receiptChecks: number,
  limits: PlanUsage["limits"],
): PlanUsage => ({
  month: "2026-09",
  aiDialogs,
  receiptChecks,
  limits,
});

describe("лимиты видны заранее", () => {
  // У Basic магазинов ИИ не входит (лимит 0), поэтому подсказки проверяем на Pro.
  const basic = PLAN_LIMITS.pro;

  it("до 80 % молчит", () => {
    const u = usage(Math.floor(basic.aiDialogs! * 0.79), 0, basic);
    expect(limitNotices("flowers.pro", u)).toEqual([]);
  });

  it("с 80 % — мягкая подсказка, цена плана выше из реестра", () => {
    const u = usage(Math.ceil(basic.aiDialogs! * 0.8), 0, basic);
    const [n] = limitNotices("flowers.pro", u);
    expect(n).toMatchObject({ key: "aiDialogs", limit: basic.aiDialogs, level: "near" });
    expect(n!.percent).toBe(80);
    expect(n!.next).toEqual({
      tier: "business",
      monthly: MONTHLY_PRICE.business,
      connection: CONNECTION_PRICE.business,
    });
  });

  it("на лимите — уровень over, полоска не выше 100 %", () => {
    const u = usage(basic.aiDialogs! + 50, basic.receiptChecks!, basic);
    const out = limitNotices("flowers.pro", u);
    expect(out.map((n) => [n.key, n.level, n.percent])).toEqual([
      ["aiDialogs", "over", 100],
      ["receiptChecks", "over", 100],
    ]);
  });

  it("Business без плана выше, без лимита и без плана — ничего", () => {
    const biz = PLAN_LIMITS.business;
    const [n] = limitNotices("flowers.business", usage(biz.aiDialogs!, 9999, biz));
    expect(biz.receiptChecks).toBeNull();
    expect(n!.next).toBeNull();
    expect(limitNotices("flowers.business", usage(1, 9999, biz)).length).toBe(0);
    expect(limitNotices(null, usage(9999, 9999, basic))).toEqual([]);
    expect(limitNotices("custom", usage(9999, 9999, null))).toEqual([]);
  });

  it("лимит 0 (ИИ выключен намеренно) подсказку не даёт", () => {
    expect(limitNotices("flowers.pro", usage(5, 5, { aiDialogs: 0, receiptChecks: null }))).toEqual(
      [],
    );
  });
});
