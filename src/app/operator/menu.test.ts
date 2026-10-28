import { describe, expect, it } from "vitest";
import { OPERATOR_BOTTOM_BAR, OPERATOR_MENU, operatorMenuItems } from "./menu";

describe("меню оператора", () => {
  it("группы отражают рабочие задачи оператора", () => {
    expect(OPERATOR_MENU.map((g) => g.title)).toEqual([
      "Работа",
      "Клиенты",
      "Продажи и деньги",
      "Контент",
      "Платформа",
    ]);
  });

  it("каждый раздел оператора есть в меню ровно один раз", () => {
    const tos = operatorMenuItems().map((i) => i.to);
    expect(new Set(tos).size).toBe(tos.length);
    for (const to of [
      "/operator",
      "/operator/clients",
      "/operator/clients/new",
      "/operator/revenue",
      "/operator/partners",
      "/operator/leads",
      "/operator/broadcast",
      "/operator/migration",
      "/operator/log",
      "/operator/crons",
      "/operator/settings",
      "/operator/requests",
    ]) {
      expect(tos).toContain(to);
    }
  });

  it("пункты нижней панели существуют в меню, а пустых групп нет", () => {
    const tos = operatorMenuItems().map((i) => i.to);
    for (const to of OPERATOR_BOTTOM_BAR) expect(tos).toContain(to);
    // Четвёртая кнопка панели — «Ещё».
    expect(OPERATOR_BOTTOM_BAR.length).toBe(3);
    for (const g of OPERATOR_MENU) expect(g.items.length).toBeGreaterThan(0);
  });
});
