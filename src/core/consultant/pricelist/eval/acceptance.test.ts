import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_IDS,
  acceptanceScenarios,
  compareEval,
  comparisonReport,
  evalPlan,
} from "./acceptance";
import { V2_EVAL_SCENARIOS } from "./scenarios";

describe("приёмочный набор консультанта", () => {
  it("20–30 сценариев, все есть в эталонном наборе, без повторов", () => {
    expect(ACCEPTANCE_IDS.length).toBeGreaterThanOrEqual(20);
    expect(ACCEPTANCE_IDS.length).toBeLessThanOrEqual(30);
    expect(new Set(ACCEPTANCE_IDS).size).toBe(ACCEPTANCE_IDS.length);
    const found = acceptanceScenarios();
    expect(found.map((s) => s.id)).toEqual([...ACCEPTANCE_IDS]);
  });
  it("охват: подбор, рубли, доставка, передача менеджеру, казахский, защита от взлома", () => {
    const ids = new Set<string>(ACCEPTANCE_IDS);
    for (const id of [
      "gift-towels",
      "russia-mat",
      "delivery-rf",
      "purchase",
      "kazakh",
      "injection",
    ])
      expect(ids.has(id), id).toBe(true);
  });
  it("план: ходов не больше, чем в полном наборе, и их счёт сходится", () => {
    const plan = evalPlan(acceptanceScenarios());
    expect(plan.scenarios).toBe(ACCEPTANCE_IDS.length);
    expect(plan.turns).toBeGreaterThan(plan.scenarios);
    expect(plan.turns).toBeLessThan(evalPlan(V2_EVAL_SCENARIOS).turns);
  });
});

describe("сравнение прогонов", () => {
  const r = (id: string, pass: boolean) => ({ id, title: `Сценарий ${id}`, pass });
  it("находит сломавшиеся, починившиеся и непарные сценарии", () => {
    const c = compareEval(
      [r("a", true), r("b", false), r("c", true), r("only-old", true)],
      [r("a", true), r("b", true), r("c", false), r("only-new", false)],
    );
    expect(c.regressed).toEqual(["c"]);
    expect(c.fixed).toEqual(["b"]);
    expect(c.onlyBefore).toEqual(["only-old"]);
    expect(c.onlyAfter).toEqual(["only-new"]);
    expect(c.same).toHaveLength(3);
  });
  it("отчёт называет итог и рисует таблицу", () => {
    const md = comparisonReport(compareEval([r("a", true)], [r("a", false)]), "прогоном v1");
    expect(md).toContain("## Сравнение с прогоном v1");
    expect(md).toContain("Сломалось: 1");
    expect(md).toContain("| a — Сценарий a | ✅ | ❌ |");
  });
});
