import { describe, expect, it } from "vitest";
import { normalizeTemplateName, templateBody, templateParamCount } from "./templates";
import { parseExcludedPhones } from "@/core/broadcasts/broadcasts";

describe("шаблоны WhatsApp", () => {
  it("считает плейсхолдеры и достаёт тело", () => {
    const c = [
      { type: "HEADER", text: "Привет, {{1}}" },
      { type: "BODY", text: "Ваш заказ {{2}} готов, сумма {{3}}" },
    ];
    expect(templateParamCount(c)).toBe(3);
    expect(templateBody(c)).toBe("Ваш заказ {{2}} готов, сумма {{3}}");
    expect(templateParamCount(null)).toBe(0);
    expect(templateBody("мусор")).toBe("");
  });
  it("имя — по правилам Meta", () => {
    expect(normalizeTemplateName(" Order Ready! v2 ")).toBe("order_ready_v2");
    expect(normalizeTemplateName("___")).toBe("");
  });
  it("исключённые номера: любой разделитель, только цифры", () => {
    const s = parseExcludedPhones("+7 701 123-45-67, 77012223344;\n+1 (555) 000 1111");
    expect([...s]).toEqual(["77011234567", "77012223344", "15550001111"]);
    expect(parseExcludedPhones(null).size).toBe(0);
  });
});
