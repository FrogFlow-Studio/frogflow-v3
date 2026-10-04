import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
const patchTenantSettings = vi.fn(async () => {});
vi.mock("@/core/tenant/resolve.server", () => ({ patchTenantSettings }));
/** Сообщение продавцу и кулдаун — забота стража каналов (guard.server.test.ts). */
let notified = true;
const markChannelDown = vi.fn(async () => ({ notified }));
vi.mock("./guard.server", () => ({ markChannelDown }));

const { handleAccountDisconnected } = await import("./handle-account");

const BOT = "11111111-1111-1111-1111-111111111111";
const ctxOf = () =>
  ({
    tenant: {
      id: BOT,
      settings: { zernio: { accounts: [{ id: "acc-1", expired: false }] } },
    },
  }) as unknown as TenantContext;
const event = (accountId: string, platform = "instagram") => ({
  account: { accountId, username: "aa_teach_", platform },
});

beforeEach(() => {
  notified = true;
  markChannelDown.mockClear();
  patchTenantSettings.mockClear();
});

describe("Zernio: аккаунт отключился (опись v1: tests/zernio-account-disconnected.test.ts)", () => {
  it("помечает аккаунт в снимке и передаёт канал стражу", async () => {
    const ctx = ctxOf();
    const r = await handleAccountDisconnected(ctx, event("acc-1"));
    expect(r.notified).toBe(true);
    expect(patchTenantSettings).toHaveBeenCalledWith(BOT, {
      zernio: { accounts: [{ id: "acc-1", expired: true }] },
    });
    expect(markChannelDown).toHaveBeenCalledWith(ctx, "instagram", "token");
  });

  it("WhatsApp-аккаунт — канал whatsapp", async () => {
    await handleAccountDisconnected(ctxOf(), event("acc-1", "whatsapp"));
    expect(markChannelDown).toHaveBeenCalledWith(expect.anything(), "whatsapp", "token");
  });

  it("страж уже сообщал об этом отключении — повторного сообщения нет", async () => {
    notified = false;
    const r = await handleAccountDisconnected(ctxOf(), event("acc-1"));
    expect(r).toMatchObject({ notified: false, note: "уже уведомляли об этом отключении" });
  });

  it("неизвестный аккаунт снимок не трогает", async () => {
    await handleAccountDisconnected(ctxOf(), event("acc-9"));
    expect(patchTenantSettings).not.toHaveBeenCalled();
  });
});
