import { describe, expect, it } from "vitest";
import { modelChoice, modelWeek } from "./model-choice";

const LIST = ["claude-haiku-4-5-20251001", "claude-sonnet-5"];

describe("модель консультанта глазами оператора", () => {
  it("верное значение — оно и отвечает", () => {
    expect(modelChoice(" claude-sonnet-5 ", LIST, "claude-haiku-4-5")).toEqual({
      stored: "claude-sonnet-5",
      effective: "claude-sonnet-5",
      unknown: false,
    });
  });

  it("опечатка видна: отвечает модель платформы, а не записанная", () => {
    expect(modelChoice("claude-sonnet-5-2026", LIST, "claude-haiku-4-5")).toEqual({
      stored: "claude-sonnet-5-2026",
      effective: "claude-haiku-4-5",
      unknown: true,
    });
  });

  it("не задано — модель платформы без ошибки", () => {
    expect(modelChoice(undefined, LIST, "claude-haiku-4-5")).toMatchObject({
      effective: "claude-haiku-4-5",
      unknown: false,
    });
  });

  it("расход по моделям за неделю: ходы, сумма, цена хода; без модели не считается", () => {
    const w = modelWeek([
      { model: "claude-sonnet-5", token_usage: { usd: 0.01 } },
      { model: "claude-sonnet-5", token_usage: { usd: 0.03 } },
      { model: "claude-haiku-4-5-20251001", token_usage: { usd: 0.004 } },
      { model: "claude-haiku-4-5-20251001", token_usage: {} },
      { model: null, token_usage: { usd: 5 } },
    ]);
    expect(w).toEqual([
      { model: "claude-haiku-4-5-20251001", runs: 2, usd: 0.004, avgUsd: 0.002 },
      { model: "claude-sonnet-5", runs: 2, usd: 0.04, avgUsd: 0.02 },
    ]);
  });
});
