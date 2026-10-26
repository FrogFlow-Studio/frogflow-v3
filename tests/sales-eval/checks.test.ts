import { describe, expect, it } from "vitest";
import { checkTurn, isCanned, salesSummary, scenarioResult, type TurnOutcome } from "./checks";
import { SALES_SCENARIOS } from "./scenarios";

const out = (o: Partial<TurnOutcome> = {}): TurnOutcome => ({
  replies: ["Лестницы для кабинета: печатаете на А4. 2 000 ₸."],
  buttons: ["🛒 Купить"],
  newOrders: 0,
  handedOff: false,
  ...o,
});

describe("набор продаж: проверки хода", () => {
  it("кнопка «Купить» или заказ — это предложение купить", () => {
    expect(checkTurn(out(), { buy: "offer" })).toEqual([]);
    expect(checkTurn(out({ buttons: [], newOrders: 1 }), { buy: "offer" })).toEqual([]);
    expect(checkTurn(out({ buttons: [] }), { buy: "offer" })).toEqual(["no_offer"]);
    expect(checkTurn(out(), { buy: "none" })).toEqual(["unexpected_offer"]);
  });

  it("«Оформляем заказ?» под ценой, простыня и передача менеджеру видны", () => {
    const asked = out({ replies: ["Стоимость 3500 KZT. Оформляем заказ?"], buttons: [] });
    expect(checkTurn(asked, { buy: "offer", noQuestionEnd: true })).toEqual([
      "no_offer",
      "question_end",
    ]);
    expect(checkTurn(out({ replies: ["а".repeat(700)] }))).toEqual(["too_long"]);
    expect(checkTurn(out({ handedOff: true }))).toEqual(["handoff"]);
    expect(checkTurn(out({ handedOff: true }), { handoff: true })).toEqual([]);
  });

  it("заготовка кода вместо ответа — на любом языке", () => {
    expect(isCanned("Уточните, пожалуйста, что именно вас интересует — подскажу.")).toBe(true);
    expect(isCanned("Нақты не қызықтыратынын айтыңызшы — көмектесемін.")).toBe(true);
    expect(isCanned("Пока заказ не оформлен. Что именно вы хотели узнать о товаре?")).toBe(true);
    expect(isCanned("Уточните, пожалуйста, какой класс?")).toBe(false);
    expect(
      checkTurn(out({ replies: ["Уточните, пожалуйста, что именно вас интересует — подскажу."] })),
    ).toEqual(["canned"]);
  });

  it("казахский ответ и факт из карточки", () => {
    expect(checkTurn(out(), { kazakh: true })).toEqual(["not_kazakh"]);
    expect(checkTurn(out({ replies: ["Иә, қазақша бар."] }), { kazakh: true })).toEqual([]);
    expect(checkTurn(out(), { must: [/[АA]4/u] })).toEqual([]);
    expect(checkTurn(out(), { must: [/А3/u] })).toEqual(["missing_fact"]);
  });

  it("сценарий: дошёл ли до кнопки к концу и сводка", () => {
    const s = {
      id: "x",
      title: "x",
      origin: "x",
      locale: "ru" as const,
      turns: [],
      reachOffer: true,
    };
    const quiet = {
      say: "?",
      replies: ["Какой класс?"],
      buttons: [],
      flags: [],
      outcome: out({ buttons: [] }),
    };
    const r = scenarioResult(s, [quiet]);
    expect(r).toMatchObject({ pass: false, offered: false, flags: ["no_offer"] });
    const ok = scenarioResult(s, [quiet, { ...quiet, outcome: out() }]);
    expect(ok).toMatchObject({ pass: true, offered: true });
    expect(salesSummary([r, ok])).toMatchObject({ scenarios: 2, passed: 1, offered: 1 });
  });

  it("набор: id не повторяются, у каждого сценария есть источник и реплики", () => {
    expect(new Set(SALES_SCENARIOS.map((s) => s.id)).size).toBe(SALES_SCENARIOS.length);
    for (const s of SALES_SCENARIOS) {
      expect(s.origin).toMatch(/\d{2}\.10/);
      expect(s.turns.length).toBeGreaterThan(0);
    }
  });
});
