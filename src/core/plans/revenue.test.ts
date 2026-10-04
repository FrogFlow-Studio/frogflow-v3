import { describe, expect, it } from "vitest";
import {
  cashByMonth,
  cashByMonthAndTier,
  churnSummary,
  monthlyRevenue,
  periodPayment,
  revenueState,
  summarizeRevenue,
  upcomingRenewals,
  type RevenueNamed,
} from "./revenue";

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

const named = (
  botId: string,
  plan: string | null,
  expiresAt: string | null,
  billing: RevenueNamed["billing"] = {},
): RevenueNamed => ({ botId, name: `Клиент ${botId}`, plan, billing, expiresAt });

describe("продления, отток и поступления по тарифам", () => {
  it("платёж за период: месяц и год за 10 месяцев, с каналами", () => {
    expect(periodPayment("flowers.pro", {})).toBe(19_900);
    expect(periodPayment("flowers.pro", { addons: ["whatsapp"] })).toBe(24_900);
    expect(periodPayment("flowers.basic", { period: "year" })).toBe(99_000);
    expect(periodPayment("custom", {})).toBeNull();
  });

  it("продления: только платящие, срок от сегодня до +14 включительно, по дате", () => {
    const { renewals, expectedTotal } = upcomingRenewals(
      [
        named("a", "digital.pro", "2026-10-02"), // через 6 дней
        named("b", "digital.basic", "2026-09-26"), // сегодня
        named("c", "digital.basic", "2026-10-10", { period: "year" }), // через 14 дней, годовой
        named("d", "digital.basic", "2026-10-11"), // через 15 — рано
        named("e", "digital.basic", "2026-09-25"), // просрочен — не продление
        named("f", "digital.basic", "2026-10-01", { trial_until: "2026-10-01" }), // пробный
        named("g", "custom", "2026-10-01"), // без цены
        { ...named("h", "digital.basic", "2026-10-01"), archived: true },
      ],
      "2026-09-26",
    );
    expect(renewals.map((r) => [r.botId, r.daysLeft])).toEqual([
      ["b", 0],
      ["a", 6],
      ["c", 14],
    ]);
    expect(renewals.find((r) => r.botId === "c")!.expected).toBe(99_000);
    expect(expectedTotal).toBe(9_900 + 19_900 + 99_000);
  });

  it("продления: порядок не зависит от порядка входа", () => {
    const list = [
      named("x", "digital.basic", "2026-10-01"),
      named("y", "digital.basic", "2026-10-01"),
    ];
    const a = upcomingRenewals(list, "2026-09-26").renewals.map((r) => r.botId);
    const b = upcomingRenewals([...list].reverse(), "2026-09-26").renewals.map((r) => r.botId);
    expect(a).toEqual(b);
  });

  it("отток: срок истёк в окне 30 дней и не продлён; пробный без оплаты и давние не считаются", () => {
    const c = churnSummary(
      [
        named("a", "digital.pro", "2026-09-20"), // ушёл 6 дней назад
        named("b", "digital.basic", "2026-08-27"), // 30 дней назад — в окне
        named("c", "digital.basic", "2026-08-26"), // 31 — раньше окна
        named("d", "digital.basic", "2026-09-20", { trial_until: "2026-09-20" }), // пробный не оплатил
        named("e", "digital.basic", "2026-09-20", { trial_until: "2026-09-10" }), // платил после пробного
        named("f", "digital.basic", "2026-10-20"), // платит
        named("g", "digital.basic", null), // сроков нет
        named("h", "custom", "2026-09-20"), // без цены
      ],
      "2026-09-26",
    );
    expect(c.clients.map((x) => x.botId)).toEqual(["a", "e", "b"]);
    expect(c.lostMrr).toBe(19_900 + 9_900 + 9_900);
    // 1 платящий (f) + 3 ушедших.
    expect(c.ratePct).toBe(75);
  });

  it("отток: нет платящих и ушедших — доли нет, а не 0 %", () => {
    expect(churnSummary([], "2026-09-26")).toEqual({ clients: [], lostMrr: 0, ratePct: null });
  });

  it("поступления по месяцам и тарифам: только оплаченные тенге, тариф — текущий, прочие — «other»", () => {
    const tiers = new Map<string, "basic" | "pro">([
      ["a", "basic"],
      ["b", "pro"],
    ]);
    const rows = cashByMonthAndTier(
      [
        { bot_id: "a", paid_at: "2026-09-02T10:00:00Z", amount: 9_900, currency: "KZT" },
        { bot_id: "a", paid_at: "2026-09-20T10:00:00Z", amount: 9_900, currency: "KZT" },
        { bot_id: "b", paid_at: "2026-09-05T10:00:00Z", amount: 19_900, currency: "KZT" },
        { bot_id: "z", paid_at: "2026-09-06T10:00:00Z", amount: 5_000, currency: "KZT" },
        { bot_id: "a", paid_at: "2026-09-07T10:00:00Z", amount: 0, currency: "KZT" }, // пробный
        { bot_id: "a", paid_at: "2026-09-08T10:00:00Z", amount: 100, currency: "USD" },
        { bot_id: "a", paid_at: "2025-01-01T10:00:00Z", amount: 7, currency: "KZT" }, // вне окна
      ],
      (id) => tiers.get(id) ?? null,
      "2026-09-26",
    );
    expect(rows).toHaveLength(12);
    const sep = rows.at(-1)!;
    expect(sep).toMatchObject({
      month: "2026-09",
      basic: 19_800,
      pro: 19_900,
      business: 0,
      other: 5_000,
      total: 44_700,
      count: 4,
    });
    // Итог по тарифам совпадает с суммой месяца и с cashByMonth.
    for (const r of rows) expect(r.basic + r.pro + r.business + r.other).toBe(r.total);
    expect(rows.map((r) => r.month)).toEqual(cashByMonth([], "2026-09-26").map((r) => r.month));
  });
});
