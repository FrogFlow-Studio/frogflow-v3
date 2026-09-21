import { describe, expect, it } from "vitest";
import {
  addSpend,
  estimateUsd,
  formatDailyCount,
  parseDailyCount,
  parseSmartSearchIds,
  parseSpend,
} from "./smart-pure";

describe("parseSmartSearchIds", () => {
  it("берёт JSON из текста и отбрасывает чужие и повторные id", () => {
    const text = 'Вот ответ: {"ids": ["a", "zzz", "b", "a"]} — готово';
    expect(parseSmartSearchIds(text, ["a", "b", "c"])).toEqual(["a", "b"]);
  });
  it("мусор — пустой список", () => {
    expect(parseSmartSearchIds("ничего", ["a"])).toEqual([]);
    expect(parseSmartSearchIds("{not json", ["a"])).toEqual([]);
    expect(parseSmartSearchIds('{"ids": "a"}', ["a"])).toEqual([]);
  });
});

describe("счётчики и расход", () => {
  it("дневной счётчик сбрасывается новой датой", () => {
    expect(parseDailyCount("2026-09-21:17", "2026-09-21")).toBe(17);
    expect(parseDailyCount("2026-09-20:17", "2026-09-21")).toBe(0);
    expect(parseDailyCount(null, "2026-09-21")).toBe(0);
    expect(formatDailyCount(3, "2026-09-21")).toBe("2026-09-21:3");
  });
  it("стоимость по ценам Haiku и накопление", () => {
    expect(estimateUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
    expect(estimateUsd({ inputTokens: 0, outputTokens: 200_000 })).toBe(1);
    const s = addSpend(parseSpend(null), { inputTokens: 10_000, outputTokens: 100 });
    expect(s.count).toBe(1);
    expect(s.usd).toBeCloseTo(0.0105, 6);
    expect(parseSpend(JSON.stringify(s))).toEqual(s);
    expect(parseSpend("{oops")).toEqual({ count: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
  });
});
