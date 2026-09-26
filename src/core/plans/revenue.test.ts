import { describe, expect, it } from "vitest";
import { cashByMonth, monthlyRevenue, revenueState, summarizeRevenue } from "./revenue";

const today = "2026-09-26";

describe("выручка платформы", () => {
  it("месячная выручка клиента: план, каналы, годовая оплата", () => {
    expect(monthlyRevenue("flowers.basic", {})).toBe(9_900);
    expect(monthlyRevenue("flowers.pro", { addons: ["whatsapp", "instagram"] })).toBe(29_900);
    expect(monthlyRevenue("flowers.basic", { period: "year" })).toBe(8_250);
    expect(monthlyRevenue("custom", {})).toBeNull();
    expect(monthlyRevenue(null, {})).toBeNull();
  });

  it("состояние: пробный, платит, просрочен, без плана", () => {
    const plan = "digital.basic";
    expect(
      revenueState(
        { plan, billing: { trial_until: "2026-10-02" }, expiresAt: "2026-10-02" },
        today,
      ),
    ).toBe("trial");
    expect(
      revenueState(
        { plan, billing: { trial_until: "2026-10-02" }, expiresAt: "2026-11-02" },
        today,
      ),
    ).toBe("paying");
    expect(revenueState({ plan, billing: {}, expiresAt: "2026-09-26T00:00:00Z" }, today)).toBe(
      "paying",
    );
    expect(revenueState({ plan, billing: {}, expiresAt: "2026-09-20" }, today)).toBe("overdue");
    expect(revenueState({ plan, billing: {}, expiresAt: null }, today)).toBe("overdue");
    expect(revenueState({ plan: "custom", billing: {}, expiresAt: "2027-01-01" }, today)).toBe(
      "no_plan",
    );
  });

  it("сводка: MRR только платящих, архив не считается", () => {
    const s = summarizeRevenue(
      [
        { plan: "flowers.basic", billing: {}, expiresAt: "2026-10-20" },
        { plan: "flowers.pro", billing: {}, expiresAt: "2026-10-20" },
        { plan: "flowers.pro", billing: {}, expiresAt: "2026-10-20", archived: true },
        { plan: "digital.basic", billing: { trial_until: "2026-10-01" }, expiresAt: "2026-10-01" },
        { plan: "digital.business", billing: {}, expiresAt: "2026-09-01" },
        { plan: null, billing: {}, expiresAt: null },
      ],
      today,
    );
    expect(s).toMatchObject({
      mrr: 29_800,
      arr: 357_600,
      paying: 2,
      arpu: 14_900,
      trial: 1,
      trialMrr: 9_900,
      overdue: 1,
      overdueMrr: 39_900,
      noPlan: 1,
    });
    expect(s.byTier.pro).toEqual({ clients: 1, mrr: 19_900 });
  });

  it("поступления по месяцам: нулевые платежи и чужая валюта не считаются", () => {
    const rows = cashByMonth(
      [
        { paid_at: "2026-09-05T10:00:00Z", amount: 24_900, currency: "KZT" },
        { paid_at: "2026-09-10T10:00:00Z", amount: 0, currency: "KZT" },
        { paid_at: "2026-08-10T10:00:00Z", amount: 9_900, currency: "KZT" },
        { paid_at: "2026-08-11T10:00:00Z", amount: 50, currency: "USD" },
        { paid_at: "2025-01-01T10:00:00Z", amount: 9_900, currency: "KZT" },
      ],
      today,
      3,
    );
    expect(rows).toEqual([
      { month: "2026-07", amount: 0, count: 0 },
      { month: "2026-08", amount: 9_900, count: 1 },
      { month: "2026-09", amount: 24_900, count: 1 },
    ]);
  });
});
