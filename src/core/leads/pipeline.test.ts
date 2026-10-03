import { describe, expect, it } from "vitest";
import { DEFAULT_PIPELINE, normalizePipelineConfig, planLead, type PipelineLead } from "./pipeline";

const NOW = new Date("2026-10-20T06:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const lead = (o: Partial<PipelineLead> = {}): PipelineLead => ({
  stage: "contacted",
  next_action: "Мой шаг",
  next_action_at: null,
  last_touch_at: day(1),
  contacted_at: day(1),
  updated_at: day(1),
  created_at: day(30),
  ...o,
});
const cfg = { ...DEFAULT_PIPELINE, enabled: true };

describe("normalizePipelineConfig", () => {
  it("по умолчанию выключен", () => {
    expect(normalizePipelineConfig(undefined).enabled).toBe(false);
    expect(normalizePipelineConfig("мусор").enabled).toBe(false);
    expect(normalizePipelineConfig('{"enabled":"true"}').enabled).toBe(false);
  });
  it("включается только явным true, числа в границах, потерян позже напоминания", () => {
    const c = normalizePipelineConfig('{"enabled":true,"followUpDays":99,"lostDays":2}');
    expect(c).toEqual({ enabled: true, followUpDays: 30, lostDays: 31 });
  });
});

describe("planLead", () => {
  it("свежий «Написали» — ничего", () => {
    expect(planLead(lead(), NOW, cfg)).toEqual({});
  });
  it("молчит дольше срока напоминания — напомнить", () => {
    expect(planLead(lead({ last_touch_at: day(4) }), NOW, cfg)).toEqual({ remind: true });
  });
  it("свой срок следующего шага важнее молчания", () => {
    expect(planLead(lead({ next_action_at: day(-2) }), NOW, cfg)).toEqual({});
    expect(planLead(lead({ next_action_at: day(1) }), NOW, cfg)).toEqual({ remind: true });
  });
  it("молчит N дней после «Написали» — потерян, и больше ничего", () => {
    expect(planLead(lead({ last_touch_at: day(14) }), NOW, cfg)).toEqual({ lose: true });
  });
  it("«Ответил» и «Горячий» сами не теряются", () => {
    expect(planLead(lead({ stage: "hot", last_touch_at: day(60) }), NOW, cfg)).toEqual({
      remind: true,
    });
  });
  it("подсказка по стадии только в пустое поле", () => {
    expect(planLead(lead({ stage: "new", next_action: null }), NOW, cfg)).toEqual({
      nextAction: "Оценить лид",
    });
    expect(planLead(lead({ stage: "new", next_action: "  " }), NOW, cfg).nextAction).toBe(
      "Оценить лид",
    );
    expect(planLead(lead({ stage: "new" }), NOW, cfg)).toEqual({});
  });
  it("закрытые стадии не трогаем", () => {
    for (const stage of ["converted", "rejected", "lost", "неизвестная"])
      expect(
        planLead(lead({ stage, next_action: null, last_touch_at: day(90) }), NOW, cfg),
      ).toEqual({});
  });
});
