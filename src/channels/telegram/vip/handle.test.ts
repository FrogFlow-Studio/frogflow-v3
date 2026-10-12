import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import { fakeDb } from "../../../../tests/fake-db";

const reported: unknown[] = [];
vi.mock("@/lib/errors", () => ({
  reportError: async (e: unknown, c: unknown) => void reported.push([e, c]),
}));

const { handleVipUpdate } = await import("./handle");

describe("handleVipUpdate", () => {
  it("сбой обработки не роняет вебхук и уходит в учёт ошибок с клиентом", async () => {
    const ctx = {
      tenant: { id: "bot-1" },
      db: {
        from: () => {
          throw new Error("db down");
        },
      },
    } as unknown as TenantContext;
    const api = { call: async () => ({ ok: true }) } as unknown as TelegramApi;
    await expect(
      handleVipUpdate(ctx, api, {
        update_id: 7,
        message: {
          message_id: 1,
          chat: { id: 5, type: "private" },
          from: { id: 5 },
          text: "/status",
        },
      } as never),
    ).resolves.toBeUndefined();
    expect(reported).toHaveLength(1);
    const [err, c] = reported[0] as [unknown, unknown];
    expect(err).toBeInstanceOf(Error);
    expect(c).toEqual({
      where: "telegram.vip",
      botId: "bot-1",
      extra: { update_id: 7, kind: "message" },
    });
  });

  it("первый /start: сначала язык, тарифы — после выбора и уже на нём (Копилка, 12.10)", async () => {
    const BOT = "00000000-0000-0000-0000-000000000001";
    const db = fakeDb();
    db.tables.app_settings = [];
    db.tables.vip_member_profiles = [];
    db.tables.vip_subscriptions = [];
    db.tables.vip_tariffs = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        bot_id: BOT,
        name: "Подписка на месяц",
        price: 5000,
        currency: "KZT",
        duration_days: 30,
        is_active: true,
        is_public: true,
        is_entry: false,
        sort_order: 0,
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    const ctx = {
      tenant: { id: BOT, modules: {}, settings: {} },
      timezone: "Asia/Almaty",
      appUrl: "https://app.example",
      db,
    } as unknown as TenantContext;
    const calls: [string, Record<string, unknown>][] = [];
    const api = {
      call: async (m: string, p: Record<string, unknown>) => {
        calls.push([m, p]);
        return { ok: true, result: {} };
      },
    } as unknown as TelegramApi;
    const from = { id: 5, first_name: "Анна" };
    await handleVipUpdate(ctx, api, {
      update_id: 1,
      message: { message_id: 1, chat: { id: 5, type: "private" }, from, text: "/start" },
    } as never);
    const texts = () => calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));
    expect(texts()).toEqual(["Выберите язык"]);
    calls.length = 0;
    await handleVipUpdate(ctx, api, {
      update_id: 2,
      callback_query: {
        id: "q",
        from,
        data: "vip_locale:kk:s",
        message: { message_id: 2, chat: { id: 5 } },
      },
    } as never);
    expect(texts()[0]).toBe("✅ Тіл сақталды.");
    const tariffs = calls.find(([, p]) => JSON.stringify(p).includes("buy_tariff:"));
    expect(tariffs).toBeDefined();
    expect(reported.slice(1)).toEqual([]);
  });
});
