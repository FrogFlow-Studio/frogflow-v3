import { describe, expect, it } from "vitest";
import { abHalf, abResult, splitForAb } from "./ab";

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
});
