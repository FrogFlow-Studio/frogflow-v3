import { describe, expect, it } from "vitest";
import { fillFunnelText, funnelDue, parseFunnel } from "./funnel";

const cfg = parseFunnel(
  JSON.stringify({
    enabled: true,
    steps: [
      { afterHours: 72, text: "третий день" },
      { afterHours: 1, text: "{name}, привет", catalogButton: true },
      { afterHours: 24, text: "день спустя" },
      { afterHours: 0, text: "мусор" },
      { afterHours: 5, text: "" },
    ],
  }),
);
const created = "2026-09-20T00:00:00Z";
const at = (h: number) => new Date(Date.parse(created) + h * 3600_000);

describe("автоворонка", () => {
  it("шаги сортируются по времени, мусор отбрасывается", () => {
    expect(cfg.steps.map((s) => s.afterHours)).toEqual([1, 24, 72]);
    expect(cfg.stopOnOrder).toBe(true);
  });
  it("шаг по времени от первого контакта; опоздавшие не шлются пачкой — только последний", () => {
    expect(funnelDue(cfg, created, 0, at(0.5))).toBeNull();
    expect(funnelDue(cfg, created, 0, at(2))).toBe(0);
    expect(funnelDue(cfg, created, 1, at(2))).toBeNull();
    expect(funnelDue(cfg, created, 1, at(30))).toBe(1);
    expect(funnelDue(cfg, created, 0, at(100))).toBe(2);
    expect(funnelDue(cfg, created, 3, at(100))).toBeNull();
  });
  it("подстановка имени", () => {
    expect(fillFunnelText("{name}, привет", "Аня")).toBe("Аня, привет");
    expect(fillFunnelText("{name}!", null)).toBe("Здравствуйте!");
  });
});
