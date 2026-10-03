import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";

// Крон лидов: выключен по умолчанию, дальше — настоящий путь по строкам sales_leads.
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const sent: string[] = [];
let sendResult: { ok: true } | { ok: false; reason: "not_configured" } = { ok: true };
vi.mock("./health-alerts.server", () => ({
  sendOperatorAlert: async (html: string) => {
    sent.push(html);
    return sendResult;
  },
}));

const srv = await import("./leads-pipeline.server");

const NOW = new Date("2026-10-20T06:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
let seq = 0;
const addLead = (o: Record<string, unknown> = {}) => {
  const id = `lead-${++seq}`;
  db.tables.sales_leads!.push({
    id,
    business_name: `Лид ${seq}`,
    stage: "contacted",
    next_action: "Мой шаг",
    next_action_at: null,
    last_touch_at: day(1),
    contacted_at: day(1),
    updated_at: day(1),
    created_at: day(30),
    ...o,
  });
  return id;
};
const enable = (v: Record<string, unknown> = {}) =>
  (db.tables.operator_settings = [
    { key: "v3_lead_cron", value: JSON.stringify({ enabled: true, ...v }) },
  ]);
const lead = (id: string) => db.tables.sales_leads!.find((l) => l.id === id)!;

beforeEach(() => {
  setEnvForTests({ APP_URL: "https://app.example" } as never);
  db.tables.sales_leads = [];
  db.tables.sales_lead_events = [];
  db.tables.operator_settings = [];
  sent.length = 0;
  sendResult = { ok: true };
});

describe("runLeadPipeline", () => {
  it("без флага ничего не делает: v1 ведёт те же строки", async () => {
    const id = addLead({ last_touch_at: day(40) });
    expect(await srv.runLeadPipeline(NOW)).toEqual({ enabled: false });
    expect(lead(id).stage).toBe("contacted");
    expect(sent).toHaveLength(0);
    expect(db.tables.sales_lead_events).toHaveLength(0);
  });

  it("молчащий «Написали» уходит в «Потерян» с причиной и событием", async () => {
    enable();
    const id = addLead({ last_touch_at: day(15) });
    const r = await srv.runLeadPipeline(NOW);
    expect(r).toMatchObject({ enabled: true, lost: 1, reminded: 0 });
    expect(lead(id)).toMatchObject({ stage: "lost", lost_reason: "Нет ответа 14 дн." });
    expect(db.tables.sales_lead_events).toMatchObject([
      { lead_id: id, actor: "cron", kind: "stage" },
    ]);
  });

  it("лид, которого v1 уже сдвинул, не откатывается: стадия сменилась между чтением и записью", async () => {
    enable();
    const id = addLead({ last_touch_at: day(15) });
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      if (t === "sales_leads") lead(id).stage = "replied";
      return real(t);
    }) as typeof db.from;
    const r = await srv.runLeadPipeline(NOW);
    db.from = real;
    expect(r).toMatchObject({ lost: 0 });
    expect(lead(id).stage).toBe("replied");
  });

  it("напоминание уходит один раз: срок сдвигается до отправки, повторный прогон молчит", async () => {
    enable();
    const id = addLead({ last_touch_at: day(4), business_name: "Кофейня <Север>" });
    expect(await srv.runLeadPipeline(NOW)).toMatchObject({ reminded: 1, message: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Кофейня &lt;Север&gt;");
    expect(sent[0]).toContain("https://app.example/operator/leads");
    expect(Date.parse(lead(id).next_action_at as string)).toBe(NOW.getTime() + 3 * 86_400_000);
    expect(await srv.runLeadPipeline(NOW)).toMatchObject({ reminded: 0, message: "none" });
    expect(sent).toHaveLength(1);
    // через следующие N дней — снова
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    expect(await srv.runLeadPipeline(later)).toMatchObject({ reminded: 1 });
  });

  it("два крона одновременно: напоминает только тот, кто сдвинул срок", async () => {
    enable();
    const id = addLead({ last_touch_at: day(4) });
    const [a, b] = await Promise.all([srv.runLeadPipeline(NOW), srv.runLeadPipeline(NOW)]);
    const total = [a, b].reduce((n, r) => n + (r.enabled ? r.reminded : 0), 0);
    expect(total).toBe(1);
    expect(sent).toHaveLength(1);
    expect(lead(id).next_action_at).not.toBeNull();
  });

  it("подсказка пишется только в пустое поле, свой шаг не затирается", async () => {
    enable();
    const a = addLead({ stage: "new", next_action: null, last_touch_at: null });
    const b = addLead({ stage: "new", next_action: "Позвонить завтра" });
    expect(await srv.runLeadPipeline(NOW)).toMatchObject({ hints: 1 });
    expect(lead(a).next_action).toBe("Оценить лид");
    expect(lead(b).next_action).toBe("Позвонить завтра");
  });

  it("канал оператора не настроен: напоминание отмечено, сообщения нет, это видно в итоге", async () => {
    enable();
    addLead({ last_touch_at: day(4) });
    sendResult = { ok: false, reason: "not_configured" };
    expect(await srv.runLeadPipeline(NOW)).toMatchObject({
      reminded: 1,
      message: "not_configured",
    });
  });

  it("сбой чтения списка — serverFailure, а не «лидов нет»", async () => {
    enable();
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t);
      return t === "sales_leads"
        ? Object.assign(q, {
            select: () => ({
              order: () => ({
                order: () => ({ range: async () => ({ data: null, error: { message: "boom" } }) }),
              }),
            }),
          })
        : q;
    }) as typeof db.from;
    await expect(srv.runLeadPipeline(NOW)).rejects.toMatchObject({ name: "ServerFailure" });
    db.from = real;
  });

  it("сбой чтения настроек — serverFailure, а не «выключен»", async () => {
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t);
      return t === "operator_settings"
        ? Object.assign(q, {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          })
        : q;
    }) as typeof db.from;
    await expect(srv.runLeadPipeline(NOW)).rejects.toMatchObject({ name: "ServerFailure" });
    db.from = real;
  });
});

describe("настройки", () => {
  it("сохраняются и читаются, значения в границах", async () => {
    expect(await srv.getPipelineConfig()).toMatchObject({ enabled: false });
    await srv.savePipelineConfig({ enabled: true, followUpDays: 2, lostDays: 10 });
    expect(await srv.getPipelineConfig()).toEqual({ enabled: true, followUpDays: 2, lostDays: 10 });
  });
});
