import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

// ИИ-оценка лида: запись оценки, событие, переход по порогам, отказ без ключа и при сбое.
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

let apiKey: string | undefined = "sk-test";
vi.mock("@/config/env", () => ({ env: () => ({ ANTHROPIC_API_KEY: apiKey }) }));

let reply: string | Error = "";
const create = vi.fn(async () => {
  if (reply instanceof Error) throw reply;
  return { content: [{ type: "text", text: reply }] };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const srv = await import("./leads.server");
const NOW = new Date("2026-10-03T10:00:00Z");

const seed = (o: Record<string, unknown> = {}) => {
  db.tables.sales_leads = [
    { id: "l1", business_name: "Кофейня Север", stage: "new", score: null, ...o },
  ];
};

beforeEach(() => {
  apiKey = "sk-test";
  create.mockClear();
  db.tables.sales_lead_events = [];
  db.tables.operator_settings = [];
  seed();
});

describe("scoreLead", () => {
  it("высокая оценка: пишет оценку и причину, событие scored, лид → «Подходит»", async () => {
    reply = '{"score": 82, "reason": "Продаёт в Instagram"}';
    expect(await srv.scoreLead("l1", "admin_a", NOW)).toEqual({
      ok: true,
      score: 82,
      reason: "Продаёт в Instagram",
      movedTo: "qualified",
    });
    expect(db.tables.sales_leads![0]).toMatchObject({
      score: 82,
      score_reason: "Продаёт в Instagram",
      stage: "qualified",
    });
    expect(db.tables.sales_lead_events!.map((e) => e.kind)).toEqual(["scored", "stage"]);
  });

  it("низкая оценка → «Не подходит»; средняя стадию не трогает", async () => {
    reply = '{"score": 10, "reason": "нет онлайна"}';
    expect(await srv.scoreLead("l1", "a", NOW)).toMatchObject({ movedTo: "rejected" });
    seed();
    reply = '{"score": 50, "reason": "возможно"}';
    expect(await srv.scoreLead("l1", "a", NOW)).toMatchObject({ ok: true, movedTo: null });
    expect(db.tables.sales_leads![0]!.stage).toBe("new");
  });

  it("пороги берутся из настроек оператора", async () => {
    db.tables.operator_settings = [
      { key: "lead_pipeline", value: '{"qualifyMinScore":90,"rejectMaxScore":5}' },
    ];
    reply = '{"score": 82, "reason": "x"}';
    expect(await srv.scoreLead("l1", "a", NOW)).toMatchObject({ movedTo: null });
  });

  it("лид уже вне «Нового» (ответил): оценка пишется, стадия остаётся", async () => {
    seed({ stage: "replied" });
    reply = '{"score": 5, "reason": "x"}';
    expect(await srv.scoreLead("l1", "a", NOW)).toMatchObject({ ok: true, movedTo: null });
    expect(db.tables.sales_leads![0]).toMatchObject({ stage: "replied", score: 5 });
  });

  it("ответ не разобрался — ничего не пишем", async () => {
    reply = "не знаю";
    expect(await srv.scoreLead("l1", "a", NOW)).toEqual({ ok: false, reason: "unreadable" });
    expect(db.tables.sales_leads![0]!.score).toBeNull();
    expect(db.tables.sales_lead_events).toHaveLength(0);
  });

  it("сбой модели — serverFailure, лид не тронут", async () => {
    reply = new Error("timeout");
    await expect(srv.scoreLead("l1", "a", NOW)).rejects.toThrow(/ИИ-оценка лида/);
    expect(db.tables.sales_leads![0]!.score).toBeNull();
  });

  it("без ключа — отказ без вызова модели; нет лида — not_found", async () => {
    apiKey = undefined;
    expect(srv.leadsAiAvailable()).toBe(false);
    await expect(srv.scoreLead("l1", "a", NOW)).rejects.toThrow(/ключ/);
    expect(create).not.toHaveBeenCalled();
    apiKey = "sk-test";
    expect(srv.leadsAiAvailable()).toBe(true);
    expect(await srv.scoreLead("zzz", "a", NOW)).toEqual({ ok: false, reason: "not_found" });
    expect(create).not.toHaveBeenCalled();
  });
});
