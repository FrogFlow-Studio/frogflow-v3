import { describe, expect, it } from "vitest";
import { salesPace, type PaceOrder } from "./pace";

// 15:30 в Алматы (UTC+5) 5 октября: 10:30 UTC.
const NOW = new Date("2026-10-05T10:30:00Z");
const TZ = "Asia/Almaty";
const o = (at: string, total: number, over: Partial<PaceOrder> = {}): PaceOrder => ({
  created_at: at,
  total,
  paid_amount: total,
  currency: "KZT",
  status: "delivered",
  ...over,
});

describe("«Сегодня»: продажи к этому же времени вчера и по часам", () => {
  it("сегодня и вчера до этого же часа считаются раздельно; позже вчера не в счёт", () => {
    const p = salesPace(
      [
        o("2026-10-05T04:10:00Z", 5000), // сегодня 09:10
        o("2026-10-05T09:00:00Z", 3000), // сегодня 14:00
        o("2026-10-04T05:00:00Z", 4000), // вчера 10:00 — до 15:30
        o("2026-10-04T12:00:00Z", 9000), // вчера 17:00 — после 15:30
        o("2026-10-03T05:00:00Z", 7000), // позавчера
      ],
      NOW,
      TZ,
    );
    expect(p.today).toBe(8000);
    expect(p.yesterdaySoFar).toBe(4000);
    expect(p.orders).toBe(2);
    expect(p.deltaPct).toBe(100);
    expect(p.byHour[9]).toBe(5000);
    expect(p.byHour[14]).toBe(3000);
    expect(p.byHour.reduce((a, b) => a + b, 0)).toBe(8000);
  });

  it("день и час — по поясу магазина: 02:00 по Алматы ещё «сегодня», хотя в UTC вчера", () => {
    const p = salesPace([o("2026-10-04T21:00:00Z", 1500)], NOW, TZ);
    expect(p.today).toBe(1500);
    expect(p.byHour[2]).toBe(1500);
  });

  it("пустой день — нули и deltaPct null (страница пишет «пока нет продаж»)", () => {
    const p = salesPace([], NOW, TZ);
    expect(p).toMatchObject({ today: 0, yesterdaySoFar: 0, orders: 0, deltaPct: null });
    expect(p.byHour).toHaveLength(24);
  });

  it("вчера не было, сегодня есть — сравнивать не с чем (null, не «бесконечность»)", () => {
    const p = salesPace([o("2026-10-05T04:10:00Z", 5000)], NOW, TZ);
    expect(p.deltaPct).toBeNull();
  });

  it("не считаются: не выданные и чужая валюта; задаток физического — внесённое", () => {
    const p = salesPace(
      [
        o("2026-10-05T04:10:00Z", 5000, { status: "awaiting_payment" }),
        o("2026-10-05T04:10:00Z", 100, { currency: "USD" }),
        o("2026-10-05T05:10:00Z", 8000, {
          status: "in_production",
          fulfillment_kind: "physical",
          paid_amount: 3000,
        }),
        o("2026-10-05T06:10:00Z", 2000),
      ],
      NOW,
      TZ,
    );
    expect(p.currency).toBe("KZT");
    expect(p.today).toBe(5000);
    expect(p.orders).toBe(2);
  });

  it("падение в сумме вчера меньше 0: минус считается", () => {
    const p = salesPace(
      [o("2026-10-05T04:10:00Z", 2000), o("2026-10-04T04:10:00Z", 4000)],
      NOW,
      TZ,
    );
    expect(p.deltaPct).toBe(-50);
  });
});
