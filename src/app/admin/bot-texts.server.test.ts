import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { Tenant } from "@/core/tenant/types";

/** «Тексты бота»: сохранение с повышением rev, сброс, чужие ключи не затираются, предпросмотр на 4 языках. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { botTexts, saveBotText, saveWorkHours } = await import("./bot-texts.server");
const { tenantContext, invalidateTenantDirectory } = await import("@/core/tenant/resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000aa";

type Saved = {
  rev: number;
  slug?: string;
  served_by?: string;
  zernio?: unknown;
  work_hours?: unknown;
  bot_texts?: Record<string, unknown>;
};
const settings = () => db.tables.bots![0]!.settings as Saved;
const texts = () => settings().bot_texts as Record<string, { telegram?: { ru?: string } } | null>;

function ctx(modules: Record<string, boolean> = {}) {
  const t = {
    id: BOT,
    name: "Лавка",
    status: "active",
    vertical: "digital",
    modules,
    archived: false,
    settings: settings(),
  } as unknown as Tenant;
  return tenantContext(t);
}

beforeEach(() => {
  setEnvForTests({});
  invalidateTenantDirectory();
  db = fakeDb();
  db.tables.bots = [
    {
      id: BOT,
      name: "Лавка",
      slug: "lavka",
      settings: { served_by: "v2", rev: 4, slug: "lavka", zernio: { profile_id: "p" } },
    },
  ];
  db.tables.app_settings = [];
  // директория арендаторов: свежее чтение настроек читает bots
  vi.doMock("@/core/tenant/resolve.server", async (orig) => ({
    ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  }));
});
afterEach(() => setEnvForTests(undefined));

describe("страница «Тексты бота»", () => {
  it("показывает стандартные тексты четырёх языков и подключённые каналы", async () => {
    const view = await botTexts(ctx({ multi_language: true }));
    expect(view.locales).toEqual(["ru", "kk", "en", "uz"]);
    expect(view.channels.find((c) => c.channel === "telegram")!.wired).toHaveLength(4);
    expect(view.channels.find((c) => c.channel === "instagram")!.wired).toContain("language_ask");
    expect(view.channels.find((c) => c.channel === "whatsapp")!.wired).toEqual([]);
    for (const row of view.rows)
      for (const l of view.locales)
        expect(row.standard[l].length, `${row.key}/${l}`).toBeGreaterThan(5);
    expect(view.rows.find((r) => r.key === "order_thanks")!.optIn).toBe(true);
  });

  it("стандарт шага Instagram — фраза бота без HTML, с {подстановками} вместо значений", async () => {
    const rows = (await botTexts(ctx())).rows;
    expect(rows.find((r) => r.key === "language_ask")!.standard.ru).toBe(
      "🌐 На каком языке нужны материалы?",
    );
    expect(rows.find((r) => r.key === "receipt_received_email")!.standard.ru).toBe(
      "✅ Чек по заказу #{order} получен. После проверки пришлём материалы сюда и на {email}.",
    );
  });

  it("без многоязычности — только язык магазина", async () => {
    expect((await botTexts(ctx())).locales).toEqual(["ru"]);
  });
});

describe("сохранение", () => {
  it("пишет в bots.settings.bot_texts, повышает rev и не трогает чужие ключи", async () => {
    await saveBotText(ctx(), {
      key: "welcome",
      channel: "telegram",
      texts: { ru: "  Привет, {shop}!  " },
    });
    expect(settings().bot_texts).toEqual({ welcome: { telegram: { ru: "Привет, {shop}!" } } });
    expect(settings().rev).toBe(5);
    expect(settings().slug).toBe("lavka");
    expect(settings().served_by).toBe("v2");
    expect(settings().zernio).toEqual({ profile_id: "p" });
  });

  it("второй язык добавляется, первый остаётся; другой ключ не затирается", async () => {
    await saveBotText(ctx(), { key: "welcome", channel: "telegram", texts: { ru: "Привет" } });
    await saveBotText(ctx(), { key: "welcome", channel: "telegram", texts: { kk: "Сәлем" } });
    await saveBotText(ctx(), {
      key: "not_understood",
      channel: "telegram",
      texts: { ru: "Не понял" },
    });
    expect(settings().bot_texts).toEqual({
      welcome: { telegram: { ru: "Привет", kk: "Сәлем" } },
      not_understood: { telegram: { ru: "Не понял" } },
    });
    expect(settings().rev).toBe(7);
  });

  it("сброс: пустой текст убирает язык, последний убранный язык обнуляет ключ", async () => {
    await saveBotText(ctx(), {
      key: "welcome",
      channel: "telegram",
      texts: { ru: "Привет", kk: "Сәлем" },
    });
    await saveBotText(ctx(), { key: "welcome", channel: "telegram", texts: { ru: "" } });
    expect(texts().welcome).toEqual({ telegram: { kk: "Сәлем" } });
    await saveBotText(ctx(), { key: "welcome", channel: "telegram", texts: { kk: null } });
    expect(texts().welcome).toBeNull();
    const view = await botTexts(ctx());
    expect(view.rows.find((r) => r.key === "welcome")!.custom).toEqual({});
  });

  it("канал, где текст не подключён (Instagram), не сохраняется: бот его не отправил бы", async () => {
    await saveBotText(ctx(), { key: "welcome", channel: "instagram", texts: { ru: "Привет" } });
    await saveBotText(ctx(), { key: "language_ask", channel: "whatsapp", texts: { ru: "Язык?" } });
    expect(settings().bot_texts).toBeUndefined();
    expect(settings().rev).toBe(4);
  });

  it("шаг покупки в Instagram сохраняется", async () => {
    await saveBotText(ctx(), {
      key: "language_ask",
      channel: "instagram",
      texts: { ru: "На каком языке?\n👇 В ответ отправьте только цифру." },
    });
    expect(settings().bot_texts).toEqual({
      language_ask: { instagram: { ru: "На каком языке?\n👇 В ответ отправьте только цифру." } },
    });
  });

  it("длинный текст обрезается до предела, управляющие символы убираются", async () => {
    await saveBotText(ctx(), {
      key: "not_understood",
      channel: "telegram",
      texts: { ru: `а\u0007${"б".repeat(2000)}` },
    });
    expect(texts().not_understood?.telegram?.ru).toHaveLength(1000);
    expect(texts().not_understood?.telegram?.ru).not.toContain("\u0007");
  });
});

describe("рабочие часы", () => {
  it("сохраняются и убираются; кривые значения — часов нет", async () => {
    expect(await saveWorkHours(ctx(), { open: 9, close: 18 })).toEqual({ open: 9, close: 18 });
    expect(settings().work_hours).toEqual({ open: 9, close: 18 });
    expect(await saveWorkHours(ctx(), { open: 9, close: 9 })).toBeNull();
    expect(settings().work_hours).toBeNull();
    expect(settings().slug).toBe("lavka");
  });
});
