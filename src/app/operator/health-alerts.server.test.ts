import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import { isEncryptedSecret } from "@/core/secrets/vault";

/**
 * Канал уведомлений оператору и прогон крона здоровья на базе в памяти.
 * Telegram подставной: запоминает вызовы, отвечает как настоящий.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

type Call = { token: string; method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let tgUp = true;
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: (token: string) => ({
    call: async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push({ token, method, payload });
      if (!tgUp) return { ok: false, description: "Bad Gateway" };
      if (token === "111111:revoked-token-xxxxxxxxxxxxxxxxxxxxxxxxx")
        return { ok: false, description: "Unauthorized" };
      if (method === "getMe") return { ok: true, result: { username: "ff_alerts_bot" } };
      if (payload.chat_id === "999")
        return { ok: false, description: "Bad Request: chat not found" };
      return { ok: true, result: {} };
    },
    fileUrl: () => "",
  }),
}));

const a = await import("./health-alerts.server");
const { ALERT_KEYS } = a;

const TOKEN = "123456789:AAHfakeTokenForTests_abcdefghijklmn";
const value = (key: string) =>
  (db.tables.operator_settings ?? []).find((r) => r.key === key)?.value as string | undefined;
const sends = () => calls.filter((c) => c.method === "sendMessage");
const names = new Map([["b", "Дидактика"]]);
const at = (min: number) => new Date(Date.UTC(2026, 8, 27, 3, 0) + min * 60_000).toISOString();

beforeEach(() => {
  setEnvForTests({});
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.operator_settings = [{ key: "operator_username", value: "admin_a" }];
  calls = [];
  tgUp = true;
});

describe("настройка канала", () => {
  it("по умолчанию не настроен; сообщения тихо не отправляются", async () => {
    expect(await a.alertChannelStatus()).toEqual({
      configured: false,
      chatId: null,
      botUsername: null,
    });
    expect(await a.sendOperatorAlert("x")).toEqual({ ok: false, reason: "not_configured" });
    expect(calls).toEqual([]);
    expect((await a.testAlertChannel()).ok).toBe(false);
  });

  it("токен проверяется в Telegram и хранится зашифрованным", async () => {
    await a.saveAlertChannel({ token: ` ${TOKEN} `, chatId: "123456789" });
    const stored = value(ALERT_KEYS.token)!;
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain(TOKEN.split(":")[1]);
    expect(await a.alertChannelStatus()).toEqual({
      configured: true,
      chatId: "123456789",
      botUsername: "ff_alerts_bot",
    });
    expect(await a.testAlertChannel()).toEqual({
      ok: true,
      message: "Пробное сообщение отправлено.",
    });
    expect(sends()[0]).toMatchObject({ token: TOKEN, payload: { chat_id: "123456789" } });
  });

  it("пустой токен оставляет прежний; без прежнего — ошибка", async () => {
    await expect(a.saveAlertChannel({ token: "", chatId: "123456789" })).rejects.toThrow(
      /токен бота/,
    );
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    const stored = value(ALERT_KEYS.token);
    await a.saveAlertChannel({ token: "", chatId: "-1001234567890" });
    expect(value(ALERT_KEYS.token)).toBe(stored);
    expect(value(ALERT_KEYS.chatId)).toBe("-1001234567890");
  });

  it("неверный токен или chat id не сохраняются", async () => {
    await expect(a.saveAlertChannel({ token: "abc", chatId: "123456789" })).rejects.toThrow(
      /BotFather/,
    );
    await expect(
      a.saveAlertChannel({
        token: "111111:revoked-token-xxxxxxxxxxxxxxxxxxxxxxxxx",
        chatId: "123456789",
      }),
    ).rejects.toThrow(/Unauthorized/);
    await expect(a.saveAlertChannel({ token: TOKEN, chatId: "@me" })).rejects.toThrow(/число/);
    expect(value(ALERT_KEYS.token)).toBeUndefined();
    expect(value(ALERT_KEYS.chatId)).toBeUndefined();
  });

  it("«Проверить» объясняет, если бот не может написать в чат", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "999" });
    const r = await a.testAlertChannel();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/chat not found.*«Старт»/);
  });

  it("«Выключить» удаляет только ключи канала", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    await a.clearAlertChannel();
    expect((await a.alertChannelStatus()).configured).toBe(false);
    expect(db.tables.operator_settings!.map((r) => r.key)).toEqual(["operator_username"]);
  });
});

describe("прогон крона здоровья", () => {
  const down = { bot_id: "b", ok: false, error: "вебхук: не установлен" };
  const up = { bot_id: "b", ok: true, error: null };

  it("одно сообщение на сбой и одно на восстановление, без повторов", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    calls = [];
    for (let i = 0; i < 5; i++) await a.processHealthAlerts([down], names, at(i * 15));
    await a.processHealthAlerts([up], names, at(75));
    await a.processHealthAlerts([up], names, at(90));
    await a.processHealthAlerts([up], names, at(105));
    const texts = sends().map((c) => String(c.payload.text));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("«Дидактика» не отвечает");
    expect(texts[0]).toContain("/operator/clients/b");
    expect(texts[1]).toContain("снова отвечает");
    expect(texts[1]).toContain("Простой: 1 ч 30 мин.");
    expect(JSON.parse(value(ALERT_KEYS.state)!)).toEqual({});
  });

  it("канал не настроен: молчим; настроили во время сбоя — сообщение уходит", async () => {
    await a.processHealthAlerts([down], names, at(0));
    const r = await a.processHealthAlerts([down], names, at(15));
    expect(r).toMatchObject({ down: 1, sent: 0, notConfigured: true });
    expect(calls).toEqual([]);
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    await a.processHealthAlerts([down], names, at(30));
    await a.processHealthAlerts([down], names, at(45));
    expect(sends()).toHaveLength(1);
  });

  it("сбой без сообщения оператору заканчивается молча", async () => {
    await a.processHealthAlerts([down], names, at(0));
    await a.processHealthAlerts([down], names, at(15));
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    await a.processHealthAlerts([up], names, at(30));
    expect(sends()).toEqual([]);
  });

  it("Telegram не ответил — повтор на следующем прогоне", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    tgUp = false;
    await a.processHealthAlerts([down], names, at(0));
    await a.processHealthAlerts([down], names, at(15));
    tgUp = true;
    calls = [];
    await a.processHealthAlerts([down], names, at(30));
    await a.processHealthAlerts([down], names, at(45));
    expect(sends()).toHaveLength(1);
  });

  it("здоровые боты не пишут состояние в базу", async () => {
    await a.processHealthAlerts([up], names, at(0));
    expect(value(ALERT_KEYS.state)).toBeUndefined();
  });

  it("два прогона одновременно: одно сообщение, состояние не затёрто", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    await a.processHealthAlerts([down], names, at(0));
    calls = [];
    const [r1, r2] = await Promise.all([
      a.processHealthAlerts([down], names, at(15)),
      a.processHealthAlerts([down], names, at(15)),
    ]);
    expect(sends()).toHaveLength(1);
    expect([r1.skipped, r2.skipped].filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(value(ALERT_KEYS.state)!).b).toMatchObject({ notified: true });
    await a.processHealthAlerts([down], names, at(30));
    expect(sends()).toHaveLength(1);
  });

  it("первая запись состояния двумя прогонами сразу не падает на уникальном ключе", async () => {
    const rs = await Promise.all([
      a.processHealthAlerts([down], names, at(0)),
      a.processHealthAlerts([down], names, at(0)),
    ]);
    expect(rs.filter((r) => r.skipped)).toHaveLength(1);
    expect(JSON.parse(value(ALERT_KEYS.state)!).b).toMatchObject({ fails: 1 });
  });

  it("«снова отвечает» не ушло — повтор на следующей удачной проверке", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    await a.processHealthAlerts([down], names, at(0));
    await a.processHealthAlerts([down], names, at(15));
    await a.processHealthAlerts([up], names, at(30));
    tgUp = false;
    await a.processHealthAlerts([up], names, at(45));
    tgUp = true;
    calls = [];
    await a.processHealthAlerts([up], names, at(60));
    expect(sends().map((c) => String(c.payload.text))).toEqual([
      expect.stringContaining("снова отвечает"),
    ]);
    expect(JSON.parse(value(ALERT_KEYS.state)!)).toEqual({});
  });

  it("много сбоев сразу — одно сводное сообщение", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    const many = ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ ...down, bot_id: id }));
    await a.processHealthAlerts(many, names, at(0));
    calls = [];
    const r = await a.processHealthAlerts(many, names, at(15));
    expect(r).toMatchObject({ down: 5, sent: 1 });
    expect(sends()).toHaveLength(1);
    expect(String(sends()[0]!.payload.text)).toContain("Не отвечают боты клиентов: 5");
  });
});
