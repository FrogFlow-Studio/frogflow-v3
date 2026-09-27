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
const { parseAlertStates } = await import("./health-alerts");
const { ALERT_KEYS } = a;

const TOKEN = "123456789:AAHfakeTokenForTests_abcdefghijklmn";
const value = (key: string) =>
  (db.tables.operator_settings ?? []).find((r) => r.key === key)?.value as string | undefined;
const st = (key: string) => parseAlertStates(value(key));
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
    expect(st(ALERT_KEYS.state)).toEqual({});
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
    expect(st(ALERT_KEYS.state).b).toMatchObject({ notified: true });
    await a.processHealthAlerts([down], names, at(30));
    expect(sends()).toHaveLength(1);
  });

  it("первая запись состояния двумя прогонами сразу не падает на уникальном ключе", async () => {
    const rs = await Promise.all([
      a.processHealthAlerts([down], names, at(0)),
      a.processHealthAlerts([down], names, at(0)),
    ]);
    expect(rs.filter((r) => r.skipped)).toHaveLength(1);
    expect(st(ALERT_KEYS.state).b).toMatchObject({ fails: 1 });
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
    expect(st(ALERT_KEYS.state)).toEqual({});
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

describe("оповещения о платформе", () => {
  const cronDown = { bot_id: "cron:broadcast", ok: false, error: "не запускался дольше 2 мин" };
  const cronUp = { bot_id: "cron:broadcast", ok: true, error: null };
  const labels = new Map([["cron:broadcast", "Рассылки и outbox"]]);

  it("крон: одно сообщение на сбой и одно на восстановление, ссылка на страницу кронов", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    calls = [];
    for (let i = 0; i < 4; i++) await a.processPlatformAlerts([cronDown], labels, at(i * 15));
    await a.processPlatformAlerts([cronUp], labels, at(60));
    await a.processPlatformAlerts([cronUp], labels, at(75));
    const texts = sends().map((c) => String(c.payload.text));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Крон «Рассылки и outbox» не работает");
    expect(texts[0]).toContain("/operator/crons");
    expect(texts[1]).toContain("снова работает");
  });

  it("состояния ботов и платформы раздельные: прогон одного не забывает сбой другого", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    calls = [];
    const botDown = { bot_id: "b", ok: false, error: "вебхук: не установлен" };
    for (let i = 0; i < 2; i++) {
      await a.processHealthAlerts([botDown], names, at(i * 15));
      await a.processPlatformAlerts([cronDown], labels, at(i * 15));
    }
    expect(sends()).toHaveLength(2);
    expect(Object.keys(st(ALERT_KEYS.state))).toEqual(["b"]);
    expect(Object.keys(st(ALERT_KEYS.platformState))).toEqual(["cron:broadcast"]);
    // Следующие прогоны не повторяют ни одно из сообщений.
    await a.processHealthAlerts([botDown], names, at(30));
    await a.processPlatformAlerts([cronDown], labels, at(30));
    expect(sends()).toHaveLength(2);
  });

  it("массовый сбой: условная запись сравнивает только версию, а не всё состояние", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    const long = "ошибка ".repeat(60);
    const probes = Array.from({ length: 60 }, (_, i) => ({
      bot_id: `account:bot-${i}:acc-${i}`,
      ok: false,
      error: long,
    }));
    // Условия запросов к базе: значения фильтров уходят в адрес запроса.
    const filters: string[] = [];
    const real = db;
    const spy = (q: object): object =>
      new Proxy(q, {
        get: (qt, qp) => {
          const f = Reflect.get(qt, qp) as unknown;
          if (typeof f !== "function" || qp === "then") return f;
          return (...args: unknown[]) => {
            if (["eq", "like", "is"].includes(String(qp))) filters.push(String(args[1]));
            const r = (f as (...x: unknown[]) => unknown).apply(qt, args);
            return r && typeof r === "object" ? spy(r) : r;
          };
        },
      });
    db = new Proxy(real, {
      get: (t, prop) =>
        prop === "from" ? (table: string) => spy(t.from(table)) : Reflect.get(t, prop),
    }) as FakeDb;
    for (let i = 0; i < 3; i++) await a.processPlatformAlerts(probes, new Map(), at(i * 15));
    db = real;
    expect(value(ALERT_KEYS.platformState)!.length).toBeGreaterThan(8 * 1024);
    expect(value(ALERT_KEYS.platformState)!.startsWith('{"@rev":"3"')).toBe(true);
    expect(Object.keys(st(ALERT_KEYS.platformState))).toHaveLength(60);
    expect(filters).toContain('{"@rev":"2"%');
    expect(Math.max(...filters.map((f) => f.length))).toBeLessThan(100);
    expect(sends()).toHaveLength(1);
  });

  it("состояние старого вида без версии подхватывается, сообщённое не повторяется", async () => {
    await a.saveAlertChannel({ token: TOKEN, chatId: "123456789" });
    db.tables.operator_settings!.push({
      key: ALERT_KEYS.state,
      value: JSON.stringify({
        b: { fails: 3, oks: 0, since: at(0), error: "x", notified: true },
      }),
    });
    calls = [];
    const down = { bot_id: "b", ok: false, error: "вебхук: не установлен" };
    await a.processHealthAlerts([down], names, at(45));
    expect(sends()).toEqual([]);
    expect(value(ALERT_KEYS.state)!.startsWith('{"@rev":"1"')).toBe(true);
    expect(st(ALERT_KEYS.state).b).toMatchObject({ fails: 4, notified: true });
  });
});
