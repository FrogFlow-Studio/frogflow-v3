import { describe, expect, it } from "vitest";
import { trialIssues, trialPassed, type TrialFacts } from "./trial";

const good: TrialFacts = {
  telegram: true,
  paymentMethods: true,
  sellable: true,
  physical: false,
  pickup: true,
  delivery: true,
  recipients: 1,
  total: 1500,
  mixedCurrency: false,
};

describe("пробный заказ: что мешает покупке", () => {
  it("всё на месте — проблем нет и пробный заказ прошёл", () => {
    expect(trialIssues(good)).toEqual([]);
    expect(trialPassed([])).toBe(true);
  });

  it("каждая поломка называется своим кодом", () => {
    expect(trialIssues({ ...good, telegram: false })).toEqual(["telegram"]);
    expect(trialIssues({ ...good, paymentMethods: false })).toEqual(["payment"]);
    expect(trialIssues({ ...good, sellable: false })).toEqual(["file"]);
    expect(trialIssues({ ...good, total: 0 })).toEqual(["price"]);
    expect(trialIssues({ ...good, mixedCurrency: true })).toEqual(["currency"]);
    expect(trialIssues({ ...good, physical: true, pickup: false, delivery: false })).toEqual([
      "delivery",
    ]);
  });

  it("физический товар с одним включённым способом получения — не поломка", () => {
    expect(trialIssues({ ...good, physical: true, pickup: true, delivery: false })).toEqual([]);
  });

  it("нет получателей уведомлений — предупреждение, но покупке не мешает", () => {
    const issues = trialIssues({ ...good, recipients: 0 });
    expect(issues).toEqual(["notify"]);
    expect(trialPassed(issues)).toBe(true);
  });

  it("любая блокирующая проблема — пробный заказ не прошёл", () => {
    expect(trialPassed(trialIssues({ ...good, paymentMethods: false, recipients: 0 }))).toBe(false);
  });
});
