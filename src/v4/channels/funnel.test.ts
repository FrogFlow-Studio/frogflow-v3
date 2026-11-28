import { describe, expect, it } from "vitest";
import { stepAction, type FunnelStep } from "./funnel";

const steps: FunnelStep[] = [
  { position: 1, kind: "card", payload: { title: "Палитра" } },
  { position: 2, kind: "branch", payload: { button: "more", goto: 4 } },
  { position: 3, kind: "case", payload: {} },
  { position: 4, kind: "wait", payload: { hours: 1 } },
];

const base = {
  steps,
  startedAt: new Date("2026-11-28T10:00:00Z"),
  now: new Date("2026-11-28T10:00:00Z"),
  channel: "telegram" as const,
  windowOpen: true,
};

describe("шаг воронки", () => {
  it("ветка по кнопке прыгает, без кнопки идёт в дело", () => {
    expect(stepAction({ ...base, index: 1, button: "more" })).toMatchObject({ type: "wait" });
    expect(stepAction({ ...base, index: 1, button: "no" })).toEqual({ type: "case" });
  });

  it("за краем окна Instagram карточка становится делом, не второй отправкой", () => {
    expect(stepAction({ ...base, index: 0, channel: "instagram", windowOpen: false })).toEqual({
      type: "window",
    });
    expect(stepAction({ ...base, index: 0, channel: "whatsapp", windowOpen: true })).toMatchObject({
      type: "card",
    });
  });
});
