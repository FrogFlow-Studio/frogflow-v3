import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

/** Вебхук VIP-бота переставляется, если в нём нет chat_member (защита группы). */
vi.mock("@/config/env", () => ({
  env: () => ({
    APP_URL: "https://app.test",
    WEBHOOK_SECRET: "s".repeat(40),
    TELEGRAM_API_BASE: "x",
  }),
}));
let info: Record<string, unknown> = {};
const calls: Array<[string, unknown]> = [];
vi.mock("./api", () => ({
  telegramApi: () => ({
    call: async (method: string, body?: unknown) => {
      calls.push([method, body]);
      return method === "getWebhookInfo" ? { ok: true, result: info } : { ok: true };
    },
  }),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: () => ({ secrets: { vipToken: () => "t" } }),
  patchTenantSettings: vi.fn(async () => {}),
}));

const { ensureVipWebhook, VIP_ALLOWED_UPDATES } = await import("./vip-webhook-setup.server");
const URL = "https://app.test/api/telegram/b/vip";
const tenant = {
  id: "b",
  modules: { vip: true },
  settings: { served_by: "v2", vip: { token_enc: "enc" } },
} as unknown as Tenant;

beforeEach(() => {
  calls.length = 0;
});

describe("вебхук VIP-бота", () => {
  it("старый вебхук без chat_member — переставляем с полным списком событий", async () => {
    info = { url: URL, allowed_updates: ["message", "callback_query"] };
    await ensureVipWebhook(tenant);
    const set = calls.find((c) => c[0] === "setWebhook");
    expect((set![1] as { allowed_updates: string[] }).allowed_updates).toContain("chat_member");
  });

  it("адрес и список событий совпадают — не трогаем", async () => {
    info = { url: URL, allowed_updates: [...VIP_ALLOWED_UPDATES].reverse() };
    await ensureVipWebhook(tenant);
    expect(calls.map((c) => c[0])).toEqual(["getWebhookInfo"]);
  });
});
