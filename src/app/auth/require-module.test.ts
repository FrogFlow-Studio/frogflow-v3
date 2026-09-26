import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { issueSession } from "./session-id";

/**
 * requireAdminModule — гейт серверных функций платных модулей (как
 * requireModule/requireAdminModule в v1): сначала действующая сессия
 * продавца, потом модуль его магазина.
 */
const session = { data: {} as Record<string, unknown> };
const requireTenant = vi.fn<() => Promise<Tenant>>();

vi.mock("./session.server", async (orig) => ({
  ...(await orig<typeof import("./session.server")>()),
  appSession: async () => session,
}));
vi.mock("./revocation.server", () => ({ isSessionRevoked: async () => false }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: (...a: unknown[]) => requireTenant(...(a as [])),
  tenantContext: (tenant: Tenant) => ({ tenant }),
}));

const { adminStamp, requireAdminModule, Unauthorized } = await import("./guards.server");

const BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7";
const tenant = tenantFromRow({
  id: BOT,
  bot_name: "Демо",
  status: "active",
  vertical: "digital",
  modules: { shop: true, vip: true, broadcasts: false },
  settings: { served_by: "v2", admin: { username: "anna", password_hash: "scrypt$h" } },
  paused_message: null,
  owner_telegram_id: 1,
  app_url: null,
  archived_at: null,
  bot_token: null,
} as unknown as TenantRow);

function signIn() {
  session.data = {
    admin: {
      botId: BOT,
      username: "anna",
      stamp: adminStamp(BOT, "anna", "scrypt$h"),
      ...issueSession(),
    },
  };
}

beforeEach(() => {
  session.data = {};
  requireTenant.mockReset();
  requireTenant.mockResolvedValue(tenant);
});

describe("requireAdminModule: доступ к платному модулю", () => {
  it("админ и модуль подключён — пропускает", async () => {
    signIn();
    const ctx = await requireAdminModule("vip");
    expect(ctx.tenant.id).toBe(BOT);
  });

  it("админ, но модуль не подключён — отказывает", async () => {
    signIn();
    await expect(requireAdminModule("broadcasts")).rejects.toMatchObject({
      key: "err.auth.moduleOff",
    });
  });

  it("проверяется именно запрошенный модуль", async () => {
    signIn();
    await expect(requireAdminModule("vip")).resolves.toBeTruthy();
    await expect(requireAdminModule("robokassa")).rejects.toMatchObject({
      key: "err.auth.moduleOff",
    });
  });

  it("не админ — отказывает до проверки модуля", async () => {
    await expect(requireAdminModule("vip")).rejects.toBeInstanceOf(Unauthorized);
    expect(requireTenant).not.toHaveBeenCalled();
  });

  it("ошибка чтения магазина не открывает доступ", async () => {
    signIn();
    requireTenant.mockRejectedValue(new Error("сбой базы"));
    await expect(requireAdminModule("vip")).rejects.toThrow("сбой базы");
  });
});
