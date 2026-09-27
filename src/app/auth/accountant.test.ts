import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { issueSession } from "./session-id";

/**
 * Роль «бухгалтер»: сервер закрывает ему всё, что явно не открыто.
 * Гварды настоящие, подменены только сессия и справочник магазинов.
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

const g = await import("./guards.server");

const BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7";
const row = (users: unknown[]) =>
  ({
    id: BOT,
    bot_name: "Демо",
    status: "active",
    vertical: "digital",
    modules: { shop: true, admin_roles: true, excel_export: true, manager_chat: true },
    settings: {
      served_by: "v2",
      admin: { username: "anna", password_hash: "scrypt$o", users },
    },
    paused_message: null,
    owner_telegram_id: 1,
    app_url: null,
    archived_at: null,
    bot_token: null,
  }) as unknown as TenantRow;

const tenant = tenantFromRow(
  row([
    { username: "buh", password_hash: "scrypt$b", role: "accountant" },
    { username: "kate", password_hash: "scrypt$k", role: "manager" },
  ]),
);

function signIn(username: string, hash: string) {
  session.data = {
    admin: { botId: BOT, username, stamp: g.adminStamp(BOT, username, hash), ...issueSession() },
  };
}

beforeEach(() => {
  requireTenant.mockReset();
  requireTenant.mockResolvedValue(tenant);
});

const DENIED = { key: "err.auth.accountantDenied" };

describe("бухгалтер: закрыто по умолчанию", () => {
  it("роль из настроек сохраняется, неизвестная — самая узкая («просмотр»)", () => {
    const t = tenantFromRow(
      row([
        { username: "buh", password_hash: "x", role: "accountant" },
        { username: "odd", password_hash: "x", role: "superuser" },
      ]),
    );
    expect(t.settings.admin!.users!.map((u) => u.role)).toEqual(["accountant", "viewer"]);
  });

  it("requireAdmin и все гварды на нём отказывают бухгалтеру", async () => {
    signIn("buh", "scrypt$b");
    await expect(g.requireAdmin()).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminRole("manager")).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminRole("owner")).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminRole("viewer")).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminModule("manager_chat")).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminModule("excel_export", "manager")).rejects.toMatchObject(DENIED);
    await expect(g.requireAdminAnyModule("shop")).rejects.toMatchObject(DENIED);
    await expect(g.switchAdminShop(BOT)).rejects.toMatchObject(DENIED);
  });

  it("разделы бухгалтера открыты и помечены: вызывающий режет контакты", async () => {
    signIn("buh", "scrypt$b");
    const r = await g.requireAdminFinance();
    expect(r.accountant).toBe(true);
    expect(r.ctx.tenant.id).toBe(BOT);
    // Шапка админки: кто вошёл и какая роль.
    expect(await g.adminRole()).toBe("accountant");
    expect(await g.adminIdentity()).toEqual({ botId: BOT, username: "buh" });
  });

  it("менеджер и владелец проходят как раньше, без пометки бухгалтера", async () => {
    signIn("kate", "scrypt$k");
    expect((await g.requireAdminFinance()).accountant).toBe(false);
    await expect(g.requireAdminRole("manager")).resolves.toBeTruthy();
    signIn("anna", "scrypt$o");
    expect((await g.requireAdminFinance()).accountant).toBe(false);
    await expect(g.requireAdmin()).resolves.toBeTruthy();
  });

  it("без модуля ролей бухгалтер не входит вовсе", async () => {
    requireTenant.mockResolvedValue({
      ...tenant,
      modules: { ...tenant.modules, admin_roles: false },
    });
    signIn("buh", "scrypt$b");
    await expect(g.requireAdminFinance()).rejects.toBeInstanceOf(g.Unauthorized);
  });
});
