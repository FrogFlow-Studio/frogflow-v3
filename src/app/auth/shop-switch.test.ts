import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { issueSession } from "./session-id";

/**
 * Модуль «Несколько ботов»: владелец входит в свой магазин и работает в
 * других магазинах своей группы. Право на выбранный магазин сверяется на
 * каждом запросе; чужой магазин не открывается ни при каком значении cookie.
 */
const session = {
  data: {} as Record<string, unknown>,
  update: vi.fn(async (d: Record<string, unknown>) => {
    session.data = { ...session.data, ...d };
  }),
};
const shops = new Map<string, Tenant>();

vi.mock("./session.server", async (orig) => ({
  ...(await orig<typeof import("./session.server")>()),
  appSession: async () => session,
}));
vi.mock("./revocation.server", () => ({ isSessionRevoked: async () => false }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async ({ value }: { value: string }) => {
    const t = shops.get(value);
    if (!t) throw new Error("not found");
    return t;
  },
  tenantContext: (tenant: Tenant) => ({ tenant }),
  tenantDirectory: async () => [...shops.values()],
}));
// Модуль в реестре пока «planned»; для проверки переключения считаем его готовым.
vi.mock("@/core/modules/registry", async (orig) => {
  const real = await orig<typeof import("@/core/modules/registry")>();
  return {
    ...real,
    availableModules: (m: Record<string, boolean>) => ({
      ...real.availableModules(m),
      multi_bot: m.multi_bot === true,
    }),
  };
});

const { adminShops, adminStamp, requireAdmin, switchAdminShop } = await import("./guards.server");

const HOME = "11111111-1111-4111-8111-111111111111";
const VIP = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

function shop(id: string, name: string, group: string | null, extra: Record<string, unknown> = {}) {
  return tenantFromRow({
    id,
    bot_name: name,
    status: "active",
    vertical: "digital",
    modules: { shop: true, multi_bot: true, admin_roles: true },
    settings: {
      served_by: "v2",
      ...(group ? { multi_bot: { group } } : {}),
      ...extra,
    },
    paused_message: null,
    owner_telegram_id: 1,
    app_url: null,
    archived_at: null,
    bot_token: null,
  } as unknown as TenantRow);
}

const ADMIN = {
  username: "anna",
  password_hash: "scrypt$h",
  users: [{ username: "kate", password_hash: "scrypt$k", role: "manager" }],
};

function signIn(username = "anna", hash = "scrypt$h", activeBotId?: string) {
  session.data = {
    admin: {
      botId: HOME,
      username,
      stamp: adminStamp(HOME, username, hash),
      ...issueSession(),
      ...(activeBotId ? { activeBotId } : {}),
    },
  };
}

beforeEach(() => {
  shops.clear();
  shops.set(HOME, shop(HOME, "Развивашка", "razv", { admin: ADMIN }));
  shops.set(VIP, shop(VIP, "Развивашка VIP", "razv"));
  shops.set(FOREIGN, shop(FOREIGN, "Чужой магазин", "other"));
  session.update.mockClear();
});

describe("несколько ботов: переключение магазина в админке", () => {
  it("владелец переходит в магазин своей группы и работает в нём", async () => {
    signIn();
    await switchAdminShop(VIP);
    expect((session.data.admin as { activeBotId?: string }).activeBotId).toBe(VIP);
    expect((await requireAdmin()).tenant.id).toBe(VIP);
    await switchAdminShop(HOME);
    expect((session.data.admin as { activeBotId?: string }).activeBotId).toBeUndefined();
    expect((await requireAdmin()).tenant.id).toBe(HOME);
  });

  it("в магазин чужой группы перейти нельзя, и подставленная cookie его не открывает", async () => {
    signIn();
    await expect(switchAdminShop(FOREIGN)).rejects.toMatchObject({ key: "err.auth.shopSwitch" });
    signIn("anna", "scrypt$h", FOREIGN);
    expect((await requireAdmin()).tenant.id).toBe(HOME);
  });

  it("оператор отвязал магазин — работа возвращается в свой, без чужих данных", async () => {
    signIn("anna", "scrypt$h", VIP);
    expect((await requireAdmin()).tenant.id).toBe(VIP);
    shops.set(VIP, shop(VIP, "Развивашка VIP", null));
    expect((await requireAdmin()).tenant.id).toBe(HOME);
  });

  it("сотрудник (не владелец) остаётся в своём магазине", async () => {
    signIn("kate", "scrypt$k", VIP);
    expect((await requireAdmin()).tenant.id).toBe(HOME);
    await expect(switchAdminShop(VIP)).rejects.toMatchObject({ key: "err.auth.shopSwitch" });
    expect((await adminShops()).shops.map((t) => t.id)).toEqual([HOME]);
  });

  it("список магазинов владельца — свой и связанные, чужих нет", async () => {
    signIn();
    const r = await adminShops();
    expect(r.current).toBe(HOME);
    expect(r.shops.map((t) => t.id)).toEqual([HOME, VIP]);
  });
});
