import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdminNav } from "@/app/admin/nav-model";
import { PAYMENT_SETTING_KEYS, SETTING_KEYS, settingsForRole } from "@/app/admin/setting-keys";
import { entryVisible, SETTINGS_REGISTRY } from "@/app/admin/settings/registry";
import { findAdminLogin, roleAllows, STAFF_ROLES } from "@/core/auth/roles";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { issueSession } from "./session-id";

/**
 * Роль «Администратор» (Х3): всё, что владелец, кроме тарифа, платежей, команды, ключа API,
 * выгрузки данных и удаления магазина. Гварды настоящие, подменены сессия и справочник.
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

const IVAN = { username: "ivan", password_hash: "scrypt$i", role: "admin" };
const KATE = { username: "kate", password_hash: "scrypt$k", role: "manager" };
const tenant = tenantFromRow(row([IVAN, KATE]));

function signIn(username: string, hash: string) {
  session.data = {
    admin: { botId: BOT, username, stamp: g.adminStamp(BOT, username, hash), ...issueSession() },
  };
}

beforeEach(() => {
  requireTenant.mockReset();
  requireTenant.mockResolvedValue(tenant);
});

describe("роль «Администратор»: ранг и гварды", () => {
  it("между менеджером и владельцем; выдаётся как сотрудническая роль", () => {
    expect(roleAllows("admin", "manager")).toBe(true);
    expect(roleAllows("admin", "admin")).toBe(true);
    expect(roleAllows("admin", "owner")).toBe(false);
    expect(roleAllows("manager", "admin")).toBe(false);
    expect(roleAllows("viewer", "admin")).toBe(false);
    expect(roleAllows("accountant", "admin")).toBe(false);
    expect(roleAllows("owner", "admin")).toBe(true);
    expect(STAFF_ROLES).toContain("admin");
  });

  it("администратор проходит гвард «admin» и «manager», но не «owner»", async () => {
    signIn("ivan", "scrypt$i");
    await expect(g.requireAdminRole("admin")).resolves.toBeTruthy();
    await expect(g.requireAdminRole("manager")).resolves.toBeTruthy();
    await expect(g.requireAdminRole("owner")).rejects.toMatchObject({ key: "err.auth.ownerOnly" });
    await expect(g.requireAdminModule("admin_roles", "owner")).rejects.toMatchObject({
      key: "err.auth.ownerOnly",
    });
  });

  it("менеджеру гвард «admin» отказывает своим сообщением; владелец проходит везде", async () => {
    signIn("kate", "scrypt$k");
    await expect(g.requireAdminRole("admin")).rejects.toMatchObject({ key: "err.auth.adminOnly" });
    signIn("anna", "scrypt$o");
    await expect(g.requireAdminRole("admin")).resolves.toBeTruthy();
    await expect(g.requireAdminRole("owner")).resolves.toBeTruthy();
  });

  it("логин сотрудника с ролью admin читается как admin; неизвестная роль — «просмотр»", () => {
    expect(findAdminLogin([tenant], "ivan")?.role).toBe("admin");
    const odd = tenantFromRow(row([{ ...IVAN, username: "odd", role: "superuser" }]));
    expect(findAdminLogin([odd], "odd")?.role).toBe("viewer");
  });

  it("приглашение с ролью admin сохраняет её", () => {
    const t = tenantFromRow({
      ...row([]),
      settings: {
        served_by: "v2",
        admin: {
          username: "anna",
          password_hash: "x",
          invites: [
            {
              id: "i1",
              hash: "h",
              role: "admin",
              created_at: "2026-10-05T00:00:00Z",
              expires_at: "2099-01-01T00:00:00Z",
              by: "anna",
            },
          ],
        },
      },
    } as unknown as TenantRow);
    expect(t.settings.admin?.invites?.[0]?.role).toBe("admin");
  });
});

/** Серверные функции админки: что закрыто администратору, а что открыто — список осознанный. */
const OWNER_ONLY = new Set([
  // удаление магазина
  "admin.functions.ts:deleteShopFn",
  "admin.functions.ts:restoreShopFn",
  // команда и приглашения в команду
  "admin.functions.ts:teamFn",
  "admin.functions.ts:saveTeamMemberFn",
  "admin.functions.ts:deleteTeamMemberFn",
  "team-invite.functions.ts:staffInvitesFn",
  "team-invite.functions.ts:createStaffInviteFn",
  "team-invite.functions.ts:revokeStaffInviteFn",
  // платежи и тариф
  "admin.functions.ts:savePaymentMethodFn",
  "admin.functions.ts:deletePaymentMethodFn",
  "admin.functions.ts:requestModuleFn",
  "admin.functions.ts:commissionPageFn",
  "admin.functions.ts:requestPlanFn",
  "admin.functions.ts:payPlanFn",
  "ai-balance.functions.ts:aiBalanceCardFn",
  "ai-balance.functions.ts:aiTopupFn",
  // выгрузка данных и ключ API
  "admin.functions.ts:takeoutLinkFn",
  "api-key.functions.ts:apiKeyStatusFn",
  "api-key.functions.ts:createApiKeyFn",
  "api-key.functions.ts:revokeApiKeyFn",
]);
const OWNER_GATE = /requireAdminRole\("owner"\)|adminOwner\(\)|, "owner"\)|\bowner\(\)/;
const ADMIN_GATE = /requireAdminRole\("admin"\)|adminLevel\(\)|, "admin"\)|moduleAdmin\("admin"\)/;

function guardedFns() {
  const dir = "src/app/admin";
  const owner: string[] = [];
  const admin: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".functions.ts"))) {
    const parts = readFileSync(`${dir}/${file}`, "utf8").split(
      /^export const (\w+) = createServerFn/m,
    );
    for (let i = 1; i < parts.length; i += 2) {
      const body = parts[i + 1]!.split(/^(?:export |const |function |async function |\/\*)/m)[0]!;
      const id = `${file}:${parts[i]}`;
      if (OWNER_GATE.test(body)) owner.push(id);
      else if (ADMIN_GATE.test(body)) admin.push(id);
    }
  }
  return { owner, admin };
}

describe("что закрыто администратору на сервере", () => {
  it("«только владелец» — ровно этот список: новая функция не станет закрытой или открытой молча", () => {
    const { owner } = guardedFns();
    expect(owner.sort()).toEqual([...OWNER_ONLY].sort());
  });

  it("настройки магазина открыты администратору (гвард «admin»), а не только владельцу", () => {
    const { admin } = guardedFns();
    for (const id of [
      "admin.functions.ts:saveSettingsFn",
      "admin.functions.ts:setShopTimezoneFn",
      "admin.functions.ts:saveDeliveryZoneFn",
      "channels.functions.ts:saveDirectBotSettingsFn",
      "design.functions.ts:saveStoreDesignFn",
      "bot-texts.functions.ts:saveBotTextFn",
      "audit.functions.ts:shopAuditFn",
    ])
      expect(admin, id).toContain(id);
  });

  it("ключи платёжных систем администратор записать не может, а читать секреты не видит", () => {
    const fn = readFileSync("src/app/admin/admin.functions.ts", "utf8");
    const body = fn.split(/^export const saveSettingsFn/m)[1]!.split(/^export const /m)[0]!;
    expect(body).toContain("PAYMENT_SETTING_KEYS.has(k)");
    expect(body).toContain('(await adminRole()) !== "owner"');
    for (const k of PAYMENT_SETTING_KEYS) expect(SETTING_KEYS as readonly string[]).toContain(k);
    const secrets = { robokassa_pass1: "p", stripe_secret_key: "s", shop_name: "x" };
    expect(settingsForRole(secrets, "admin")).toEqual({ shop_name: "x" });
    expect(settingsForRole(secrets, "owner")).toEqual(secrets);
  });
});

describe("что видит администратор в интерфейсе", () => {
  const modules = { admin_roles: true, robokassa: true, stripe: true, crypto: true };
  const shop = (role: string) => ({ role, vertical: "digital", modules }) as never;

  it("разделы платежей, ключ API, выгрузка и удаление скрыты; прочие настройки видны", () => {
    // все модули включены: виден или скрыт раздел, решает только роль
    const all = new Proxy({}, { get: () => true }) as Record<string, boolean>;
    const hiddenForAdmin = SETTINGS_REGISTRY.filter(
      (e) => !entryVisible(e, { role: "admin", modules: all }),
    ).map((e) => e.id);
    expect(hiddenForAdmin.sort()).toEqual(
      [
        "ai-balance",
        "api",
        "billing",
        "commission",
        "crypto",
        "delete",
        "payment-methods",
        "prodamus",
        "robokassa",
        "stars",
        "stripe",
        "takeout",
        "team",
      ].sort(),
    );
    for (const e of SETTINGS_REGISTRY)
      expect(entryVisible(e, { role: "owner", modules: all }), e.id).toBe(true);
    for (const id of ["shop", "zones", "telegram", "invite", "design"])
      expect(hiddenForAdmin, id).not.toContain(id);
  });

  it("в меню: настройки, тексты бота и журнал — да; тариф, модули, комиссия, ИИ-баланс — нет", () => {
    const items = (role: string) =>
      buildAdminNav(shop(role)).groups.flatMap((x) => x.items.map((i) => i.to));
    const a = items("admin");
    for (const to of ["/admin/settings", "/admin/bot-texts", "/admin/log"])
      expect(a, to).toContain(to);
    for (const to of ["/admin/modules", "/admin/billing", "/admin/commission", "/admin/ai-balance"])
      expect(a, to).not.toContain(to);
    expect(items("manager")).not.toContain("/admin/settings");
    expect(items("owner")).toContain("/admin/billing");
  });
});
