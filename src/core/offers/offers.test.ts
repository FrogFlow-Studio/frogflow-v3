import { describe, expect, it } from "vitest";
import { activeOfferFor, applyOffer, offerLabel, parseOffers, type LimitedOffer } from "./offers";

const o = (over: Partial<LimitedOffer>): LimitedOffer => ({
  id: "o1",
  product_id: "p1",
  percent: 20,
  starts_at: "2026-09-20T00:00:00Z",
  ends_at: "2026-09-30T00:00:00Z",
  limit: null,
  ...over,
});
const now = new Date("2026-09-26T12:00:00Z");

describe("ограниченные предложения", () => {
  it("разбор отбрасывает мусор: без товара, процент вне 1–99, битая дата", () => {
    const raw = JSON.stringify([
      o({}),
      o({ percent: 0 }),
      o({ percent: 100 }),
      o({ ends_at: "x" }),
      { a: 1 },
    ]);
    expect(parseOffers(raw)).toHaveLength(1);
    expect(parseOffers("{")).toEqual([]);
  });
  it("действует во времени и в пределах лимита; из двух — щедрее", () => {
    const offers = [o({}), o({ id: "o2", percent: 30, limit: 5 })];
    expect(activeOfferFor(offers, "p1", new Map(), now)?.id).toBe("o2");
    expect(activeOfferFor(offers, "p1", new Map([["o2", 5]]), now)?.id).toBe("o1");
    expect(activeOfferFor(offers, "p1", new Map([["o2", 3]]), now)?.left).toBe(2);
    expect(activeOfferFor(offers, "p1", new Map(), new Date("2026-10-01T00:00:00Z"))).toBeNull();
    expect(activeOfferFor(offers, "p2", new Map(), now)).toBeNull();
  });
  it("цена со скидкой округляется и не уходит в минус", () => {
    expect(applyOffer(1500, 20)).toBe(1200);
    expect(applyOffer(999, 33)).toBe(669);
  });
  it("подпись с датой в поясе магазина и остатком", () => {
    const s = offerLabel({ ...o({ limit: 5 }), sold: 2, left: 3 }, "Asia/Almaty");
    expect(s).toContain("−20%");
    expect(s).toContain("30.09");
    expect(s).toContain("осталось 3");
  });
});
