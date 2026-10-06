import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";
import { fakeDb } from "../../../tests/fake-db";

/** Крон недельного отчёта: временный сбой — в Sentry, бот заблокирован — только в журнал. */
const reportError = vi.fn(async () => {});
let failure: Error | null = null;
/** Прогнать настоящий sendWeeklyReport с этим контекстом. */
let realCtx: unknown = null;

vi.mock("@/lib/errors", () => ({ reportError }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (t: Tenant) => realCtx ?? { tenant: t },
}));
const notified: string[] = [];
vi.mock("./notify", () => ({
  // Как настоящая: расшифровка токена бота магазина (в тестах секрет подменяется контекстом).
  adminTelegramApi: (ctx: { secrets?: { telegramToken: () => string } }) => {
    ctx.secrets?.telegramToken();
    return {};
  },
  notifyAdminsHtml: async (_ctx: unknown, html: string) => {
    notified.push(html);
    return 1;
  },
}));
vi.mock("@/core/analytics/weekly.server", async (orig) => {
  const real = await orig<typeof import("@/core/analytics/weekly.server")>();
  return {
    ...real,
    sendWeeklyReport: async (...a: Parameters<typeof real.sendWeeklyReport>) => {
      if (realCtx) return real.sendWeeklyReport(...a);
      if (failure) throw failure;
      return "sent";
    },
  };
});

const { sendDueWeeklyReports } = await import("./weekly.server");
const { WeeklySendError } = await import("@/core/analytics/weekly.server");
const shop = {
  id: "b1",
  vertical: "digital",
  modules: {},
  telegramTokenEnc: "enc",
  settings: { served_by: "v2" },
} as unknown as Tenant;

beforeEach(() => {
  reportError.mockClear();
  failure = null;
  realCtx = null;
  notified.length = 0;
});

describe("крон недельного отчёта", () => {
  it("временный сбой — ошибка уходит в Sentry", async () => {
    failure = new WeeklySendError("fetch failed", false);
    const r = await sendDueWeeklyReports([shop]);
    expect(r.b1).toBe("fetch failed");
    expect(reportError).toHaveBeenCalledWith(failure, { where: "cron:weekly", botId: "b1" });
  });

  it("бот заблокирован — запись в журнал без Sentry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failure = new WeeklySendError("Forbidden: bot was blocked by the user", true);
    const r = await sendDueWeeklyReports([shop]);
    expect(r.b1).toMatch(/^blocked: /);
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("без бота магазин пропускается", async () => {
    const r = await sendDueWeeklyReports([
      { ...shop, telegramTokenEnc: null } as unknown as Tenant,
    ]);
    expect(r).toEqual({});
  });

  it.each([
    "Секрет не зашифрован: ожидался формат enc:v1:…",
    "Повреждённый зашифрованный секрет",
    "Unsupported state or unable to authenticate data",
    "У клиента «X» не подключён Telegram-бот (нет токена)",
  ])("токен «%s» — без Sentry, одна запись за неделю, статистика не считается", async (msg) => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    const reads: string[] = [];
    const from = db.from.bind(db);
    db.from = (table: string) => {
      reads.push(table);
      return from(table);
    };
    realCtx = {
      tenant: shop,
      db,
      timezone: "Asia/Almaty",
      secrets: {
        telegramToken: () => {
          throw new Error(msg);
        },
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const monday = new Date("2026-09-28T04:30:00Z");
    for (let i = 0; i < 5; i++)
      await sendDueWeeklyReports([shop], new Date(monday.getTime() + i * 15 * 60_000));
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reads).not.toContain("orders");
    warn.mockRestore();
  });

  it("клиент v1 и клиент без served_by сводку не получают и базу не читают", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    const reads: string[] = [];
    const from = db.from.bind(db);
    db.from = (table: string) => {
      reads.push(table);
      return from(table);
    };
    realCtx = { tenant: shop, db, timezone: "Asia/Almaty" };
    const v1 = { ...shop, id: "b2", settings: { served_by: "v1" } } as unknown as Tenant;
    const none = { ...shop, id: "b3", settings: {} } as unknown as Tenant;
    const r = await sendDueWeeklyReports([v1, none], new Date("2026-09-28T04:30:00Z"));
    expect(r).toEqual({});
    expect(reads).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("два крона одновременно на настоящей отправке: один отчёт, и только выбранные блоки", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [{ bot_id: "b1", key: "weekly_report_sections", value: "top" }];
    db.tables.orders = [];
    db.tables.order_items = [];
    db.tables.bot_users = [];
    db.tables.cart_items = [];
    realCtx = {
      tenant: shop,
      db,
      timezone: "Asia/Almaty",
      secrets: { telegramToken: () => "123:abc" },
    };
    const monday = new Date("2026-09-28T04:30:00Z");
    const [a, b] = await Promise.all([
      sendDueWeeklyReports([shop], monday),
      sendDueWeeklyReports([shop], monday),
    ]);
    expect(notified).toHaveLength(1);
    // Выручка и заказы идут всегда, воронка не выбрана — её нет.
    expect(notified[0]).toContain("Выручка");
    expect(notified[0]).not.toContain("Воронка");
    expect([a.b1, b.b1].filter((x) => x === "sent")).toHaveLength(1);
  });

  it("консультант без продаж (BOVI) — отчёт из нулей не уходит, заказы не читаются; с товаром — уходит", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    db.tables.products = [];
    db.tables.orders = [];
    db.tables.order_items = [];
    db.tables.bot_users = [];
    db.tables.cart_items = [];
    const reads: string[] = [];
    const from = db.from.bind(db);
    db.from = (table: string) => {
      reads.push(table);
      return from(table);
    };
    const bovi = {
      ...shop,
      vertical: "consultant",
      modules: { shop: true, dm_shop: true },
    } as unknown as Tenant;
    realCtx = {
      tenant: bovi,
      db,
      timezone: "Asia/Almaty",
      secrets: { telegramToken: () => "123:abc" },
    };
    const monday = new Date("2026-09-28T04:30:00Z");
    expect(await sendDueWeeklyReports([bovi], monday)).toEqual({});
    expect(notified).toEqual([]);
    expect(reads).toEqual(["products"]);
    // Включил товар — продаёт, отчёт уходит.
    db.tables.products = [{ id: "p1", bot_id: "b1", is_active: true }];
    expect((await sendDueWeeklyReports([bovi], monday)).b1).toBe("sent");
    expect(notified).toHaveLength(1);
  });

  it("не прочиталось, продаёт ли, — отчёт в этот прогон не уходит, сбой в журнале", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    const bovi = {
      ...shop,
      vertical: "consultant",
      modules: { dm_shop: true },
    } as unknown as Tenant;
    const down = { data: null, count: null, error: { message: "connection reset" } };
    const from = db.from.bind(db);
    db.from = (table: string) =>
      table === "products"
        ? ({ select: () => ({ eq: async () => down }) } as unknown as ReturnType<typeof from>)
        : from(table);
    realCtx = { tenant: bovi, db, timezone: "Asia/Almaty" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendDueWeeklyReports([bovi], new Date("2026-09-28T04:30:00Z"));
    expect(r.b1).toMatch(/^skipped/);
    expect(notified).toEqual([]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
