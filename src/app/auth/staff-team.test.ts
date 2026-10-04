import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { issueSession } from "./session-id";

/**
 * Команда магазина: менеджер не открывает оплату, тариф и команду; отозванный
 * доступ перестаёт работать сразу. Гварды настоящие, подменены сессия и справочник.
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
    modules: { shop: true, admin_roles: true },
    settings: { served_by: "v2", admin: { username: "anna", password_hash: "scrypt$o", users } },
    paused_message: null,
    owner_telegram_id: 1,
    app_url: null,
    archived_at: null,
    bot_token: null,
  }) as unknown as TenantRow;

const KATE = { username: "kate", password_hash: "scrypt$k", role: "manager" };
const withKate = tenantFromRow(row([KATE]));
const withoutKate = tenantFromRow(row([]));

function signIn(username: string, hash: string) {
  session.data = {
    admin: { botId: BOT, username, stamp: g.adminStamp(BOT, username, hash), ...issueSession() },
  };
}

beforeEach(() => {
  requireTenant.mockReset();
  requireTenant.mockResolvedValue(withKate);
});

describe("менеджер и команда", () => {
  it("менеджер работает с заказами и товарами, но команда и настройки владельца ему закрыты", async () => {
    signIn("kate", "scrypt$k");
    await expect(g.requireAdminRole("manager")).resolves.toBeTruthy();
    await expect(g.requireAdminModule("admin_roles", "owner")).rejects.toMatchObject({
      key: "err.auth.ownerOnly",
    });
    await expect(g.requireAdminRole("owner")).rejects.toMatchObject({ key: "err.auth.ownerOnly" });
  });

  it("владелец проходит туда же", async () => {
    signIn("anna", "scrypt$o");
    await expect(g.requireAdminModule("admin_roles", "owner")).resolves.toBeTruthy();
  });

  it("удалённый из команды теряет доступ на следующем же запросе", async () => {
    signIn("kate", "scrypt$k");
    await expect(g.requireAdmin()).resolves.toBeTruthy();
    requireTenant.mockResolvedValue(withoutKate);
    await expect(g.requireAdmin()).rejects.toMatchObject({ role: "admin" });
  });

  it("сменивший пароль владельцем теряет старую сессию", async () => {
    signIn("kate", "scrypt$k");
    requireTenant.mockResolvedValue(tenantFromRow(row([{ ...KATE, password_hash: "scrypt$new" }])));
    await expect(g.requireAdmin()).rejects.toMatchObject({ role: "admin" });
  });
});

describe("серверные функции команды и оплаты", () => {
  const src = (f: string) => readFileSync(`src/app/admin/${f}`, "utf8");
  const body = (file: string, name: string) => {
    const parts = src(file).split(new RegExp(`^export const ${name} = `, "m"));
    return parts[1]!.split(/^export const /m)[0]!;
  };

  it("команда и приглашения — только владельцу с модулем «Роли»", () => {
    for (const n of ["teamFn", "saveTeamMemberFn", "deleteTeamMemberFn"])
      expect(body("admin.functions.ts", n)).toMatch(/adminOwner\(\)|"admin_roles", "owner"/);
    for (const n of ["staffInvitesFn", "createStaffInviteFn", "revokeStaffInviteFn"])
      expect(body("team-invite.functions.ts", n)).toContain('"admin_roles", "owner"');
  });

  it("история оплат тарифа закрыта менеджеру и «просмотру»", () => {
    const b = body("admin.functions.ts", "billingHistoryFn");
    expect(b).toContain('role === "manager" || role === "viewer"');
  });
});
