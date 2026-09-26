import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";

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
});
