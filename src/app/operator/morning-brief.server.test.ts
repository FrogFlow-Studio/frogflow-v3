import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Утренняя сводка: один раз в день, даже если два крона стартуют разом. */
let db: FakeDb;
let rows: Record<string, unknown>[];
let configured = true;
let sendOk = true;
let sendThrows = false;
let listCalls = 0;
const sent: string[] = [];

vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://f.tech/", APP_TIMEZONE: "Asia/Almaty" }),
}));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("./health-alerts.server", () => ({
  alertChannelStatus: async () => ({ configured }),
  sendOperatorAlert: async (t: string) => {
    sent.push(t);
    if (sendThrows) return { ok: false, reason: "failed", error: "timeout", maybeSent: true };
    return sendOk ? { ok: true } : { ok: false, reason: "failed", error: "x" };
  },
}));
vi.mock("./operator.server", () => ({
  listClients: async () => (
    listCalls++,
    [
      {
        id: "v2",
        name: "Должник",
        pulse: null,
        health: null,
        subscription: { state: "overdue", daysLeft: -2, policy: "grace" },
      },
      {
        id: "v1",
        name: "Старый",
        pulse: null,
        health: null,
        subscription: { state: "overdue", daysLeft: -9, policy: "grace" },
      },
    ]
  ),
}));
const { runMorningBrief, MORNING_KEY } = await import("./morning-brief.server");

const tenants = [{ id: "v2", settings: { served_by: "v2" }, archived: false }] as never;
const at = (iso: string) => new Date(iso);
const MORNING = at("2026-10-20T04:00:00Z"); // 09:00 в Алматы
const mark = () => rows.find((r) => r.key === MORNING_KEY)?.value;

beforeEach(() => {
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.operator_settings = [];
  rows = db.tables.operator_settings;
  configured = true;
  sendOk = true;
  sendThrows = false;
  listCalls = 0;
  sent.length = 0;
});

describe("runMorningBrief", () => {
  it("до 8:00 не шлёт и не ставит отметку", async () => {
    expect(await runMorningBrief(tenants, at("2026-10-20T02:00:00Z"))).toBe("notDue");
    expect(sent).toHaveLength(0);
    expect(mark()).toBeUndefined();
  });

  it("шлёт только про клиентов v2 и ставит дату; второй раз в тот же день — нет", async () => {
    expect(await runMorningBrief(tenants, MORNING)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Должник");
    expect(sent[0]).not.toContain("Старый");
    expect(mark()).toBe("2026-10-20");
    expect(await runMorningBrief(tenants, MORNING)).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("два крона разом (отметки не было) — ушло одно сообщение", async () => {
    const r = await Promise.all([
      runMorningBrief(tenants, MORNING),
      runMorningBrief(tenants, MORNING),
    ]);
    expect(r.filter((x) => x === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("два крона разом (отметка со вчера) — ушло одно сообщение", async () => {
    rows.push({ key: MORNING_KEY, value: "2026-10-19" });
    const r = await Promise.all([
      runMorningBrief(tenants, MORNING),
      runMorningBrief(tenants, MORNING),
    ]);
    expect(r.filter((x) => x === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(mark()).toBe("2026-10-20");
  });

  it("не дошло — отметка возвращена, следующий прогон повторит", async () => {
    rows.push({ key: MORNING_KEY, value: "2026-10-19" });
    sendOk = false;
    expect(await runMorningBrief(tenants, MORNING)).toBe("failed");
    expect(mark()).toBe("2026-10-19");
    sendOk = true;
    expect(await runMorningBrief(tenants, MORNING)).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("канал не настроен — ничего не шлёт и не отмечает", async () => {
    configured = false;
    expect(await runMorningBrief(tenants, MORNING)).toBe("notConfigured");
    expect(mark()).toBeUndefined();
  });

  it("сегодняшняя отметка уже есть — клиентов даже не читаем", async () => {
    rows.push({ key: MORNING_KEY, value: "2026-10-20" });
    expect(await runMorningBrief(tenants, MORNING)).toBe("already");
    expect(listCalls).toBe(0);
  });

  it("обрыв или тайм-аут отправки — отметка остаётся, второй сводки не будет", async () => {
    rows.push({ key: MORNING_KEY, value: "2026-10-19" });
    sendThrows = true;
    expect(await runMorningBrief(tenants, MORNING)).toBe("unknown");
    expect(mark()).toBe("2026-10-20");
    sendThrows = false;
    expect(await runMorningBrief(tenants, MORNING)).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("пульс не прочитан ни у кого — сводка говорит об этом, а не молчит", async () => {
    expect(await runMorningBrief(tenants, MORNING)).toBe("sent");
    expect(sent[0]).toContain("пульс клиентов не прочитан");
  });
});
