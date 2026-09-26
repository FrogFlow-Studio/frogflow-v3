import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimTelegramUpdate, telegramUpdateEventId } from "./dedupe";

const ctxFor = (id: string, db = fakeDb({ unique: { zernio_logs: [["event_id"]] } })) =>
  ({ tenant: { id }, db }) as unknown as TenantContext;

describe("claimTelegramUpdate: повтор обновления Telegram", () => {
  it("первое обновление принимает, повтор того же update_id — нет", async () => {
    const ctx = ctxFor("bot-a");
    expect(await claimTelegramUpdate(ctx, 42)).toBe(true);
    expect(await claimTelegramUpdate(ctx, 42)).toBe(false);
    expect(await claimTelegramUpdate(ctx, 43)).toBe(true);
  });

  it("одновременные доставки одного обновления — обрабатывается ровно одна", async () => {
    const ctx = ctxFor("bot-a");
    const r = await Promise.all([1, 2, 3].map(() => claimTelegramUpdate(ctx, 7)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("одинаковый update_id у разных ботов — разные обновления", async () => {
    const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
    expect(await claimTelegramUpdate(ctxFor("bot-a", db), 5)).toBe(true);
    expect(await claimTelegramUpdate(ctxFor("bot-b", db), 5)).toBe(true);
    expect(telegramUpdateEventId("bot-a", 5)).not.toBe(telegramUpdateEventId("bot-b", 5));
    // VIP-бот того же клиента нумерует обновления сам — не путаем с магазином.
    expect(await claimTelegramUpdate(ctxFor("bot-a", db), 5, "vip")).toBe(true);
  });

  it("без update_id и при сбое базы не молчит — обрабатывает", async () => {
    expect(await claimTelegramUpdate(ctxFor("bot-a"), undefined)).toBe(true);
    const broken = {
      tenant: { id: "bot-a" },
      db: { from: () => ({ insert: async () => ({ error: { message: "timeout" } }) }) },
    } as unknown as TenantContext;
    expect(await claimTelegramUpdate(broken, 1)).toBe(true);
  });
});
