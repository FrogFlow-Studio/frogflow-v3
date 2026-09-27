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
vi.mock("./notify", () => ({ notifyAdminsHtml: async () => 1 }));
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
const shop = { id: "b1", telegramTokenEnc: "enc" } as unknown as Tenant;

beforeEach(() => {
  reportError.mockClear();
  failure = null;
  realCtx = null;
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
});
