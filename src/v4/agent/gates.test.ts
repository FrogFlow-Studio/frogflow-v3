import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_GATES, buyerHearsModel, gateOpen, receiptHint } from "./gates";

describe("ИИ отдельно от кнопок", () => {
  it("все шаги выключены, пока нет своего флажка", () => {
    expect(AI_GATES.map((g) => g.id)).toEqual([
      "live_exam",
      "shadow",
      "one_shop",
      "receipt_hint",
      "seller_assistant",
      "night_review",
    ]);
    for (const g of AI_GATES) expect(gateOpen(g.id, {})).toBe(false);
    expect(buyerHearsModel(null)).toBe(false);
    expect(buyerHearsModel({ buyer: true })).toBe(true);
    expect(gateOpen("receipt_hint", { buyer: true })).toBe(false);
    expect(receiptHint({ receipt_hint: true }, "похоже на 5 000")).toBe("похоже на 5 000");
    expect(receiptHint({}, "похоже на 5 000")).toBeNull();
  });

  it("карточка и оформление модель не импортируют", () => {
    for (const f of [
      "src/v4/channels/card.ts",
      "src/v4/channels/checkout-card.ts",
      "src/v4/channels/funnel.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("agent/run");
      expect(src, f).not.toContain("anthropic");
    }
  });
});
