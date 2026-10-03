import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_THRESHOLDS,
  buildScorePrompt,
  normalizeThresholds,
  parseScore,
  stageForScore,
} from "./score";

const T = DEFAULT_LEAD_THRESHOLDS;

describe("пороги", () => {
  it("без настроек — по умолчанию; мусор не ломает", () => {
    expect(normalizeThresholds(undefined)).toEqual(T);
    expect(normalizeThresholds("не json")).toEqual(T);
    expect(normalizeThresholds("[1]")).toEqual(T);
  });
  it("зажимает в допустимые диапазоны, отказ строго ниже квалификации", () => {
    expect(normalizeThresholds('{"qualifyMinScore":10,"rejectMaxScore":99}')).toEqual({
      qualifyMinScore: 50,
      rejectMaxScore: 49,
    });
    expect(normalizeThresholds({ qualifyMinScore: "80", rejectMaxScore: 20 })).toEqual({
      qualifyMinScore: 80,
      rejectMaxScore: 20,
    });
  });
});

describe("parseScore", () => {
  it("берёт JSON из ответа с лишним текстом, округляет и зажимает", () => {
    expect(parseScore('Вот: {"score": 71.6, "reason": "Продаёт в Instagram"}')).toEqual({
      score: 72,
      reason: "Продаёт в Instagram",
    });
    expect(parseScore('{"score": 250, "reason": "x"}')?.score).toBe(100);
    expect(parseScore('{"score": -5}')).toEqual({ score: 0, reason: "" });
  });
  it("не разобралось — null", () => {
    expect(parseScore("нет json")).toBeNull();
    expect(parseScore('{"score": "высокая"}')).toBeNull();
    expect(parseScore("{сломано}")).toBeNull();
  });
});

describe("stageForScore", () => {
  it("двигает только «Новый» по порогам", () => {
    expect(stageForScore(70, "new", T)).toBe("qualified");
    expect(stageForScore(69, "new", T)).toBeNull();
    expect(stageForScore(31, "new", T)).toBeNull();
    expect(stageForScore(30, "new", T)).toBe("rejected");
    expect(stageForScore(95, "contacted", T)).toBeNull();
    expect(stageForScore(5, "hot", T)).toBeNull();
  });
});

describe("buildScorePrompt", () => {
  it("включает известные поля и не печатает пустые", () => {
    const p = buildScorePrompt({
      business_name: "Кофейня Север",
      niche: "кофе",
      city: null,
      website_url: null,
      instagram_handle: "sever",
      phone: null,
      email: null,
      signals: "Пишут «заказ в директ»",
      notes: null,
    });
    expect(p).toContain("Название: Кофейня Север");
    expect(p).toContain("Instagram: @sever");
    expect(p).toContain("Сигналы: Пишут «заказ в директ»");
    expect(p).not.toContain("Город:");
  });
});
