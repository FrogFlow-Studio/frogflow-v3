import { describe, expect, it } from "vitest";
import { compactNumber, dayKey, dayKeys, niceTicks, pctDelta, shortDay } from "./pure";

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
