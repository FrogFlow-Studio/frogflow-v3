import { describe, expect, it } from "vitest";
import { customersReport, lastWeeks, weekStart, type Purchase } from "./customers";

const TZ = "Asia/Almaty";
const now = new Date("2026-10-03T10:00:00Z"); // суббота
const p = (buyer: string, iso: string, amount = 1000, currency = "KZT"): Purchase => ({
  buyer,
  at: new Date(iso).toISOString(),
  amount,
  currency,
});

describe("недели", () => {
  it("понедельник недели", () => {
    expect(weekStart("2026-10-03T10:00:00Z", TZ)).toBe("2026-09-28");
    expect(weekStart("2026-10-04T19:30:00Z", TZ)).toBe("2026-10-05"); // воскресенье вечером UTC = уже понедельник в Алматы
    expect(lastWeeks(3, TZ, now)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });
});

describe("customersReport", () => {
  it("новые и вернувшиеся по неделям, покупатель — раз в неделю", () => {
    const r = customersReport(
      [
        p("a", "2026-09-01T10:00:00Z"),
        p("a", "2026-09-29T10:00:00Z"),
        p("a", "2026-09-30T10:00:00Z"),
        p("b", "2026-09-29T11:00:00Z"),
        p("c", "2026-09-22T11:00:00Z"),
      ],
      TZ,
      { now, weeks: 3 },
    );
    expect(r.weeks).toEqual([
      { week: "2026-09-14", fresh: 0, returning: 0 },
      { week: "2026-09-21", fresh: 1, returning: 0 },
      { week: "2026-09-28", fresh: 1, returning: 1 },
    ]);
  });

  it("топ по сумме в основной валюте, ничья — по ключу", () => {
    const r = customersReport(
      [
        p("a", "2026-09-01T10:00:00Z", 500),
        p("a", "2026-09-02T10:00:00Z", 700),
        p("b", "2026-09-03T10:00:00Z", 1200),
        p("c", "2026-09-03T10:00:00Z", 100, "USD"),
      ],
      TZ,
      { now, weeks: 4 },
    );
    expect(r.currency).toBe("KZT");
    expect(r.top.map((t) => t.buyer)).toEqual(["a", "b"]);
    expect(r.top[0]).toEqual({ buyer: "a", amount: 1200, orders: 2 });
  });

  it("топ не длиннее 20", () => {
    const list = Array.from({ length: 30 }, (_, i) => p(`u${i}`, "2026-09-03T10:00:00Z", 100 + i));
    expect(customersReport(list, TZ, { now, weeks: 4 }).top).toHaveLength(20);
  });

  it("уснувшие: две покупки и тишина 60 дней", () => {
    const r = customersReport(
      [
        p("sleep", "2026-05-01T10:00:00Z"),
        p("sleep", "2026-06-01T10:00:00Z"),
        p("once", "2026-05-01T10:00:00Z"),
        p("active", "2026-05-01T10:00:00Z"),
        p("active", "2026-09-20T10:00:00Z"),
        p("edge", "2026-06-01T10:00:00Z"),
        p("edge", "2026-08-05T10:00:00Z"), // 59 дней назад — ещё не уснул
      ],
      TZ,
      { now, weeks: 4 },
    );
    expect(r.dormant).toEqual({ count: 1, days: 60 });
  });

  it("пустая история", () => {
    const r = customersReport([], TZ, { now, weeks: 4 });
    expect(r.currency).toBeNull();
    expect(r.top).toEqual([]);
    expect(r.dormant.count).toBe(0);
    expect(r.weeks).toHaveLength(4);
  });
});
