import { describe, expect, it } from "vitest";
import {
  analyticsRevenue,
  compactNumber,
  dayKey,
  dayKeys,
  dominantCurrency,
  includeOrderInAnalytics,
  niceTicks,
  orderedCurrencies,
  pctDelta,
  shortDay,
  summarizeByCurrency,
  topProductsBySales,
  type AnalyticsItem,
} from "./pure";

describe("dayKey / dayKeys", () => {
  it("считает день в часовом поясе клиента", () => {
    expect(dayKey("2026-09-20T20:30:00Z", "Asia/Almaty")).toBe("2026-09-21");
    expect(dayKey("2026-09-20T20:30:00Z", "UTC")).toBe("2026-09-20");
  });
  it("даёт последние N дней по возрастанию, включая сегодня", () => {
    const keys = dayKeys(3, "UTC", new Date("2026-09-21T10:00:00Z"));
    expect(keys).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"]);
  });
});

describe("pctDelta", () => {
  it("процент к прошлому периоду, null когда сравнивать не с чем", () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(50, 100)).toBe(-50);
    expect(pctDelta(10, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBe(0);
    expect(pctDelta(1, 3)).toBe(-66.7);
  });
});

describe("compactNumber", () => {
  it("тысячи и миллионы", () => {
    expect(compactNumber(1284)).toBe((1284).toLocaleString("ru"));
    expect(compactNumber(12900)).toBe("12,9 тыс.");
    expect(compactNumber(4_200_000)).toBe("4,2 млн");
  });
});

describe("niceTicks", () => {
  it("круглые деления, не больше max+1", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(9500, 4)).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(niceTicks(3, 4)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(950, 4).length).toBeLessThanOrEqual(5);
    expect(niceTicks(1, 4, true)).toEqual([0, 1]);
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3]);
  });
  it("shortDay", () => {
    expect(shortDay("2026-09-21")).toBe("21.09");
  });
});

// Перенос tests/analytics.test.ts из v1: валюты не смешиваются, задаток
// физического заказа виден до выдачи, топ товаров — по проданному.
describe("выручка по валютам", () => {
  const o = (currency: string, revenue: number) => ({ currency, revenue });

  it("группирует выручку по валюте, не смешивая их", () => {
    expect(summarizeByCurrency([o("KZT", 1000), o("KZT", 2000), o("USD", 30)])).toEqual({
      KZT: { revenue: 3000, orders: 2 },
      USD: { revenue: 30, orders: 1 },
    });
  });

  it("пустой список — пустой результат", () => {
    expect(summarizeByCurrency([])).toEqual({});
  });

  it("возвращает валюту с наибольшим числом заказов", () => {
    expect(dominantCurrency([o("KZT", 1), o("KZT", 1), o("USD", 100000)])).toBe("KZT");
  });

  it("пустой список — null", () => {
    expect(dominantCurrency([])).toBeNull();
  });

  it("доминирующая валюта всегда первая, остальные — по числу заказов", () => {
    const summary = {
      RUB: { revenue: 100, orders: 5 },
      KZT: { revenue: 200, orders: 3 },
      USD: { revenue: 10, orders: 1 },
    };
    expect(orderedCurrencies(summary, "RUB")).toEqual(["RUB", "KZT", "USD"]);
  });

  it("доминирующая валюта не обязана быть первой по числу заказов в самой сводке", () => {
    const summary = { RUB: { revenue: 100, orders: 1 }, KZT: { revenue: 200, orders: 9 } };
    expect(orderedCurrencies(summary, "RUB")).toEqual(["RUB", "KZT"]);
  });

  it("без доминирующей — просто по числу заказов, при равенстве по алфавиту", () => {
    const summary = { USD: { revenue: 10, orders: 2 }, BYN: { revenue: 10, orders: 2 } };
    expect(orderedCurrencies(summary, null)).toEqual(["BYN", "USD"]);
  });
});

describe("какие заказы и какая сумма идут в выручку (задатки)", () => {
  it("цифровой заказ в аналитике только после выдачи, сумма = total", () => {
    expect(includeOrderInAnalytics({ status: "delivered", fulfillment_kind: "digital" })).toBe(
      true,
    );
    expect(
      includeOrderInAnalytics({ status: "awaiting_confirmation", fulfillment_kind: "digital" }),
    ).toBe(false);
    expect(includeOrderInAnalytics({ status: "paid", fulfillment_kind: "digital" })).toBe(false);
    expect(
      analyticsRevenue({ total: 5000, status: "delivered", fulfillment_kind: "digital" }),
    ).toBe(5000);
  });

  it("физический заказ в работе входит с paid_amount — задаток виден до выдачи", () => {
    for (const status of ["accepted", "in_production", "ready"])
      expect(includeOrderInAnalytics({ status, fulfillment_kind: "physical" })).toBe(true);
    expect(
      includeOrderInAnalytics({ status: "awaiting_confirmation", fulfillment_kind: "physical" }),
    ).toBe(false);
    expect(
      analyticsRevenue({
        total: 20000,
        status: "in_production",
        fulfillment_kind: "physical",
        paid_amount: 6000,
      }),
    ).toBe(6000);
  });

  it("выданный физический заказ считает полный total, не задаток", () => {
    expect(
      analyticsRevenue({
        total: 20000,
        status: "delivered",
        fulfillment_kind: "physical",
        paid_amount: 6000,
      }),
    ).toBe(20000);
  });
});

describe("топ товаров", () => {
  const it1 = (o: Partial<AnalyticsItem>): AnalyticsItem => ({
    order_id: 1,
    product_id: "p1",
    name_snapshot: "Товар 1",
    price_snapshot: 100,
    quantity: 1,
    ...o,
  });

  it("сортирует по количеству проданного, суммирует выручку только для указанных заказов", () => {
    const items = [
      it1({ quantity: 2 }),
      it1({ order_id: 2 }),
      it1({ product_id: "p2", name_snapshot: "Товар 2", price_snapshot: 500 }),
    ];
    const r = topProductsBySales(items, new Set([1]));
    expect(r[0]).toEqual({ name: "Товар 1", qty: 3, orders: 2, revenue: 200 });
    expect(r[1]).toEqual({ name: "Товар 2", qty: 1, orders: 1, revenue: 500 });
  });

  it("товар без product_id группируется по названию, а не теряется", () => {
    const r = topProductsBySales(
      [it1({ product_id: null, name_snapshot: "Удалённый товар", price_snapshot: 50 })],
      new Set([1]),
    );
    expect(r).toEqual([{ name: "Удалённый товар", qty: 1, orders: 1, revenue: 50 }]);
  });

  it("ограничивает результат limit позициями", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      it1({ product_id: `p${i}`, name_snapshot: `Товар ${i}`, quantity: 15 - i }),
    );
    expect(topProductsBySales(items, new Set([1]), 10)).toHaveLength(10);
  });

  it("при scale 0.3 строка 20000 даёт 6000, как сводка по paid_amount", () => {
    const r = topProductsBySales(
      [it1({ product_id: "cake", name_snapshot: "Торт", price_snapshot: 20000 })],
      new Set([1]),
      10,
      new Map([[1, 0.3]]),
    );
    expect(r[0]!.revenue).toBe(6000);
    expect(r[0]!.qty).toBe(1);
  });
});
