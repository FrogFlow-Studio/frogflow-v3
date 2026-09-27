import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const sent: string[] = [];
let tgOk = true;
vi.mock("./health-alerts.server", () => ({
  alertChannelStatus: async () => ({ configured: true }),
  sendOperatorAlert: async (html: string) => {
    sent.push(html);
    return tgOk ? { ok: true } : { ok: false, reason: "failed", error: "x" };
  },
}));
const { runConsultantModelAlerts, MODEL_ALERTS_KEY } = await import("./consultant-alerts.server");

const NOW = Date.parse("2026-09-27T21:00:00Z");
const tenant = (id: string, served_by = "v2") => ({
  id,
  name: `Клиент ${id}`,
  vertical: "digital" as const,
  archived: false,
  settings: { served_by } as never,
});
const err = `${new Date(NOW - 60_000).toISOString()} — HTTP 400: Your credit balance is too low`;

beforeEach(() => {
  setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.app_settings = [
    { bot_id: "a", key: "consultant_enabled", value: "true" },
    { bot_id: "a", key: "consultant_last_error", value: err },
    { bot_id: "v1", key: "consultant_enabled", value: "true" },
    { bot_id: "v1", key: "consultant_last_error", value: err },
  ];
  db.tables.operator_settings = [];
  sent.length = 0;
  tgOk = true;
});

describe("сигнал оператору о сбое модели консультанта", () => {
  it("одно сообщение, повторный прогон молчит; клиент v1 не читается", async () => {
    const tenants = [tenant("a"), tenant("v1", "v1")];
    expect(await runConsultantModelAlerts(tenants, NOW)).toEqual({ sent: 1, kinds: ["billing"] });
    expect(sent[0]).toContain("Клиент a");
    expect(sent[0]).not.toContain("Клиент v1");
    expect(await runConsultantModelAlerts(tenants, NOW + 15 * 60_000)).toEqual({
      sent: 0,
      kinds: [],
    });
    expect(sent).toHaveLength(1);
  });

  it("два прогона разом — одно сообщение", async () => {
    await Promise.all([
      runConsultantModelAlerts([tenant("a")], NOW),
      runConsultantModelAlerts([tenant("a")], NOW),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("Telegram не принял — отметка назад, повтор на следующем прогоне", async () => {
    tgOk = false;
    await runConsultantModelAlerts([tenant("a")], NOW);
    expect(JSON.parse(String(db.tables.operator_settings![0]!.value))).toEqual({});
    tgOk = true;
    expect(await runConsultantModelAlerts([tenant("a")], NOW + 60_000)).toMatchObject({ sent: 1 });
    expect(db.tables.operator_settings!.find((r) => r.key === MODEL_ALERTS_KEY)).toBeTruthy();
  });
});
