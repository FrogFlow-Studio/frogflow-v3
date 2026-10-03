import { describe, expect, it } from "vitest";
import { autoShare, orderSpeed, percentile, type SpeedEvent } from "./speed";

const from = new Date("2026-09-01T00:00:00Z");
const to = new Date("2026-10-01T00:00:00Z");
const at = (min: number) => new Date(Date.UTC(2026, 8, 10, 12, min)).toISOString();
const ev = (orderId: number, kind: string, min: number, actor = "bot", platform?: string) =>
  ({ orderId, kind, at: at(min), actor, platform }) satisfies SpeedEvent;

describe("percentile", () => {
  it("ближайший ранг", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});

describe("orderSpeed", () => {
  it("карта: оплата и выдача без продавца", () => {
    const rows = orderSpeed(
      [
        ev(1, "placed", 0, "bot", "telegram"),
        ev(1, "payment", 10, "system"),
        ev(1, "delivery_started", 10),
        ev(1, "delivered", 11),
      ],
      from,
      to,
    );
    expect(rows.map((r) => r.channel)).toEqual(["all", "telegram"]);
    expect(rows[0]).toMatchObject({
      placed: 1,
      pay: { count: 1, median: 10, p90: 10 },
      deliver: { count: 1, median: 1 },
      delivered: 1,
      auto: 1,
    });
    expect(autoShare(rows[0]!)).toBe(100);
  });

  it("ручное подтверждение чека — выдача не считается автоматической", () => {
    const [all] = orderSpeed(
      [
        ev(2, "placed", 0, "bot", "instagram"),
        ev(2, "delivery_started", 120, "admin:anna"),
        ev(2, "delivered", 121),
        ev(3, "placed", 5, "bot", "instagram"),
        ev(3, "payment", 6, "system"),
        ev(3, "delivered", 7),
      ],
      from,
      to,
    );
    expect(all).toMatchObject({ placed: 2, delivered: 2, auto: 1 });
    expect(all!.pay.median).toBe(1);
    expect(all!.pay.p90).toBe(120);
    expect(autoShare(all!)).toBe(50);
  });

  it("нет оплаты: заказ только оформлен — в медианы не попадает", () => {
    const [all] = orderSpeed([ev(4, "placed", 0, "bot", "web")], from, to);
    expect(all).toMatchObject({ placed: 1, delivered: 0, auto: 0 });
    expect(all!.pay).toEqual({ count: 0, median: null, p90: null });
    expect(all!.deliver.median).toBeNull();
    expect(autoShare(all!)).toBeNull();
  });

  it("отменён до оплаты: оплаты и выдачи нет", () => {
    const [all] = orderSpeed(
      [ev(5, "placed", 0, "bot", "web"), ev(5, "rejected", 30, "admin:anna")],
      from,
      to,
    );
    expect(all!.pay.count).toBe(0);
    expect(all!.delivered).toBe(0);
  });

  it("физический заказ: задаток и статусы ведёт продавец", () => {
    const [all] = orderSpeed(
      [
        ev(6, "placed", 0, "bot", "telegram"),
        ev(6, "payment", 30, "admin:anna"),
        ev(6, "status", 60, "admin:anna"),
        ev(6, "delivered", 600, "admin:anna"),
      ],
      from,
      to,
    );
    expect(all).toMatchObject({ delivered: 1, auto: 0 });
    expect(all!.deliver.median).toBe(570);
  });

  it("заказы вне периода и без события placed не считаются", () => {
    const old = new Date("2026-08-01T00:00:00Z").toISOString();
    const rows = orderSpeed(
      [
        { orderId: 7, kind: "placed", at: old, actor: "bot", platform: "web" },
        { orderId: 7, kind: "delivered", at: at(1), actor: "bot" },
        ev(8, "delivered", 1),
      ],
      from,
      to,
    );
    expect(rows[0]!.placed).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("каналы — по числу заказов, медиана и 90-й процентиль на выборке", () => {
    const events: SpeedEvent[] = [];
    for (let i = 1; i <= 10; i++) {
      events.push(ev(100 + i, "placed", 0, "bot", i <= 7 ? "telegram" : "web"));
      events.push(ev(100 + i, "payment", i, "system"));
    }
    const rows = orderSpeed(events, from, to);
    expect(rows.map((r) => r.channel)).toEqual(["all", "telegram", "web"]);
    expect(rows[0]!.pay).toEqual({ count: 10, median: 5, p90: 9 });
  });
});
