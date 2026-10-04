import { describe, expect, it } from "vitest";
import { abHalf, abResult, abVerdict, splitForAb, type AbMoneySide } from "./ab";

describe("A/B-тест рассылки", () => {
  it("половины не пересекаются, вместе — вся аудитория, близки по размеру", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    const a = splitForAb(ids, (x) => x, { group: "g1", half: 0 });
    const b = splitForAb(ids, (x) => x, { group: "g1", half: 1 });
    expect(a.length + b.length).toBe(1000);
    expect(a.some((x) => b.includes(x))).toBe(false);
    expect(Math.abs(a.length - b.length)).toBeLessThan(120);
  });

  it("повтор отбора даёт ту же половину; другой тест делит иначе", () => {
    expect(abHalf(42, "g1")).toBe(abHalf(42, "g1"));
    const ids = Array.from({ length: 200 }, (_, i) => i);
    const a1 = splitForAb(ids, (x) => x, { group: "g1", half: 0 });
    const a2 = splitForAb(ids, (x) => x, { group: "g2", half: 0 });
    expect(a1).not.toEqual(a2);
  });

  it("итог: доля нажатий и лидер; мало данных или поровну — без лидера", () => {
    expect(abResult({ id: "a", sent: 100, clicks: 12 }, { id: "b", sent: 100, clicks: 7 })).toEqual(
      {
        rateA: 12,
        rateB: 7,
        leader: "A",
      },
    );
    expect(
      abResult({ id: "a", sent: 5, clicks: 3 }, { id: "b", sent: 5, clicks: 0 }).leader,
    ).toBeNull();
    expect(abResult({ id: "a", sent: 0, clicks: 0 }, { id: "b", sent: 0, clicks: 0 }).rateA).toBe(
      0,
    );
  });

  describe("победитель по деньгам", () => {
    const side = (over: Partial<AbMoneySide>): AbMoneySide => ({
      id: "x",
      sent: 100,
      clicks: 10,
      orders: 6,
      paid: 5,
      revenue: { KZT: 50000 },
      ...over,
    });

    it("заказов хватает — выигрывает выручка, даже если нажатий меньше", () => {
      const v = abVerdict(
        side({ clicks: 30, revenue: { KZT: 20000 } }),
        side({ clicks: 5, revenue: { KZT: 90000 } }),
      );
      expect(v).toEqual({ basis: "revenue", leader: "B", lowOrders: false });
    });

    it("половины разного размера сравниваются по выручке на сообщение", () => {
      const v = abVerdict(
        side({ sent: 200, revenue: { KZT: 60000 } }),
        side({ sent: 100, revenue: { KZT: 40000 } }),
      );
      expect(v.leader).toBe("B");
    });

    it("мало заказов у одного варианта — по нажатиям и с пометкой", () => {
      const v = abVerdict(side({ clicks: 30 }), side({ clicks: 5, orders: 4 }));
      expect(v).toEqual({ basis: "clicks", leader: "A", lowOrders: true });
    });

    it("выручка в разных валютах не сравнивается напрямую", () => {
      const v = abVerdict(side({}), side({ revenue: { USD: 100 } }));
      expect(v.basis).toBe("clicks");
    });

    it("поровну — без победителя", () => {
      expect(abVerdict(side({}), side({})).leader).toBeNull();
    });
  });
});
