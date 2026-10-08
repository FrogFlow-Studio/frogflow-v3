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
const { runConsultantModelAlerts, MODEL_ALERTS_KEY, OUTAGE_KEY } =
  await import("./consultant-alerts.server");

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

describe("затяжной сбой Anthropic — оператору", () => {
  const overload = (min: number) =>
    `${new Date(NOW - min * 60_000).toISOString()} — HTTP 529: overloaded`;
  const setError = (v: string) => {
    db.tables.app_settings = [
      { bot_id: "a", key: "consultant_enabled", value: "true" },
      { bot_id: "a", key: "consultant_last_error", value: v },
    ];
  };
  const outage = () =>
    JSON.parse(
      String(db.tables.operator_settings!.find((r) => r.key === OUTAGE_KEY)?.value ?? "{}"),
    ) as Record<string, { since: string; sent?: string }>;
  beforeEach(() => {
    db.tables.consultant_message_runs = [];
  });

  it("сбой держится 30 мин при входящих — одно сообщение за эпизод", async () => {
    setError(overload(40));
    expect(await runConsultantModelAlerts([tenant("a")], NOW - 39 * 60_000)).toEqual({
      sent: 0,
      kinds: [],
    });
    setError(overload(22));
    await runConsultantModelAlerts([tenant("a")], NOW - 20 * 60_000);
    setError(overload(4));
    expect(await runConsultantModelAlerts([tenant("a")], NOW)).toEqual({
      sent: 1,
      kinds: ["outage"],
    });
    expect(sent[0]).toContain("Anthropic не отвечает больше 30 минут");
    expect(sent[0]).toContain("Клиент a");
    setError(overload(1));
    await runConsultantModelAlerts([tenant("a")], NOW + 15 * 60_000);
    expect(sent).toHaveLength(1);
  });

  it("удачный ответ в журнале после начала — эпизод заново, без сообщения", async () => {
    setError(overload(40));
    await runConsultantModelAlerts([tenant("a")], NOW - 39 * 60_000);
    db.tables.consultant_message_runs = [
      {
        id: "r1",
        bot_id: "a",
        reply_kind: "reply",
        received_at: new Date(NOW - 30 * 60_000).toISOString(),
      },
    ];
    setError(overload(22));
    await runConsultantModelAlerts([tenant("a")], NOW - 20 * 60_000);
    setError(overload(4));
    await runConsultantModelAlerts([tenant("a")], NOW);
    expect(sent).toHaveLength(0);
    expect(outage().a!.since).toBe(new Date(NOW - 22 * 60_000).toISOString());
  });

  it("два прогона разом — одно сообщение; Telegram не принял — повтор на следующем", async () => {
    setError(overload(40));
    await runConsultantModelAlerts([tenant("a")], NOW - 39 * 60_000);
    setError(overload(22));
    await runConsultantModelAlerts([tenant("a")], NOW - 20 * 60_000);
    setError(overload(4));
    tgOk = false;
    await runConsultantModelAlerts([tenant("a")], NOW);
    expect(outage().a!.sent).toBeUndefined();
    tgOk = true;
    setError(overload(2));
    await Promise.all([
      runConsultantModelAlerts([tenant("a")], NOW + 60_000),
      runConsultantModelAlerts([tenant("a")], NOW + 60_000),
    ]);
    expect(sent.filter((s) => s.includes("30 минут"))).toHaveLength(2);
    expect(outage().a!.sent).toBeTruthy();
  });

  it("ошибка стёрлась (консультант снова отвечает) — эпизод закрыт", async () => {
    setError(overload(40));
    await runConsultantModelAlerts([tenant("a")], NOW - 39 * 60_000);
    setError("");
    await runConsultantModelAlerts([tenant("a")], NOW);
    expect(outage()).toEqual({});
  });
});
