import { describe, expect, it } from "vitest";
import {
  DAILY_USD_LIMIT,
  addSpend,
  buildPrompt,
  dailySpendUsd,
  estimateUsd,
  formatDailyCount,
  parseDailyCount,
  parseSmartSearchIds,
  parseSpend,
  SMART_SEARCH_USD_MAX,
  smartSearchUsdLimit,
  spendExhausted,
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

describe("дневной предел расходов в долларах", () => {
  const D = "2026-09-26";
  const day = (usd: number, date = D) =>
    JSON.stringify({ count: 3, inputTokens: 1, outputTokens: 1, usd, date });

  it("считается только сегодняшний расход, мусор и старый день — ноль", () => {
    expect(dailySpendUsd(day(1.25), D)).toBe(1.25);
    expect(dailySpendUsd(day(9, "2026-09-25"), D)).toBe(0);
    expect(dailySpendUsd(JSON.stringify({ usd: 9 }), D)).toBe(0);
    expect(dailySpendUsd("{oops", D)).toBe(0);
    expect(dailySpendUsd(null, D)).toBe(0);
  });

  it("предел закрывает вызовы модели до полуночи UTC", () => {
    expect(spendExhausted(day(DAILY_USD_LIMIT - 0.01), D)).toBe(false);
    expect(spendExhausted(day(DAILY_USD_LIMIT), D)).toBe(true);
    expect(spendExhausted(day(DAILY_USD_LIMIT * 10, "2026-09-25"), D)).toBe(false);
  });

  it("200 запросов по самому большому каталогу не проходят под пределом", () => {
    // 600 кандидатов ≈ 90 тыс. токенов ввода: без предела в долларах
    // дневной потолок по числу запросов стоил бы десятки долларов.
    const worst = estimateUsd({ inputTokens: 90_000, outputTokens: 2_000 });
    expect(worst * 200).toBeGreaterThan(DAILY_USD_LIMIT);
  });
});

describe("свой предел умного поиска клиента (bots.settings.smart_search_limits)", () => {
  const D = "2026-09-26";
  const day = (usd: number) =>
    JSON.stringify({ count: 1, inputTokens: 1, outputTokens: 1, usd, date: D });

  it("без настройки — общий предел, своё значение — своё, опечатка в лишний ноль — не выше потолка", () => {
    expect(smartSearchUsdLimit(undefined)).toBe(DAILY_USD_LIMIT);
    expect(smartSearchUsdLimit({ daily_usd: null })).toBe(DAILY_USD_LIMIT);
    expect(smartSearchUsdLimit({ daily_usd: -1 })).toBe(DAILY_USD_LIMIT);
    expect(smartSearchUsdLimit({ daily_usd: 10 })).toBe(10);
    expect(smartSearchUsdLimit({ daily_usd: 10_000 })).toBe(SMART_SEARCH_USD_MAX);
  });

  it("поднятый предел пропускает больше расхода, 0 выключает умный поиск", () => {
    expect(spendExhausted(day(5), D)).toBe(true);
    expect(spendExhausted(day(5), D, 10)).toBe(false);
    expect(spendExhausted(day(0), D, 0)).toBe(true);
  });
});

describe("умный поиск: опись v1 (tests/smart-search.test.ts)", () => {
  const valid = ["p1", "p2"];
  const one = [{ id: "p1", name: "Тест", description: "", keywords: "" }];

  it("пустой список ids — пустой результат", () => {
    expect(parseSmartSearchIds('{"ids": []}', valid)).toEqual([]);
  });

  it("digital (умолчание, VERTICAL не задан) — промпт про учебные материалы", () => {
    const p = buildPrompt("digital", "тесты по алгебре для 7 класса", one);
    expect(p).toContain("учебный материал");
    expect(p).not.toContain("кондитерской");
    expect(buildPrompt("", "x", one)).toContain("учебный материал");
  });

  it("confectionery — промпт про торты и десерты", () => {
    const p = buildPrompt("confectionery", "что-то на день рождения пятилетке", one);
    expect(p).toContain("кондитерской");
    expect(p).not.toContain("учебный материал");
  });

  it("consultant — промпт про прайс, не учебные материалы", () => {
    for (const v of ["consultant", "consultant_universal"]) {
      const p = buildPrompt(v, "пододеяльник 200х220 бежевый", one);
      expect(p).toContain("прайса консультанта");
      expect(p).not.toContain("учебный материал");
      expect(p).not.toContain("кондитерской");
    }
  });
});
