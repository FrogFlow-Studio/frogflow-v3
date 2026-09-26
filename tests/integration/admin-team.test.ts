import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import {
  invalidateTenantDirectory,
  requireTenant,
  tenantContext,
  type TenantContext,
} from "@/core/tenant/resolve.server";
import {
  checkAdminPassword,
  deleteTeamMember,
  listTeam,
  resolveAdminLogin,
  saveTeamMember,
} from "@/app/admin/admin.server";
import { findAdminLogin } from "@/core/auth/roles";

/** Команда магазина: пользователь с ролью входит своим логином в тот же магазин. */
const LOGIN = "v2_probe_manager";
let ctx: TenantContext;
let adminBefore: Json | undefined;

/**
 * Вход команды открыт только с модулем admin_roles (PR #5). Модуль включаем
 * в памяти, а не в bots.modules: другие живые тесты читают демо-клиента
 * параллельно.
 */
const loginWithRoles = (username: string, on = true) =>
  findAdminLogin(
    [{ ...ctx.tenant, modules: { ...ctx.tenant.modules, admin_roles: on } }],
    username,
  );

async function fresh() {
  invalidateTenantDirectory();
  return tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
}

describe.skipIf(!liveReady)("роли: команда магазина на демо-клиенте", () => {
  beforeAll(async () => {
    const { data } = await serviceDb().from("bots").select("settings").eq("id", DEMO_BOT).single();
    adminBefore = (data?.settings as { admin?: Json })?.admin;
    ctx = await fresh();
    await deleteTeamMember(ctx, LOGIN);
    ctx = await fresh();
  });
  afterAll(async () => {
    const { data } = await serviceDb().from("bots").select("settings").eq("id", DEMO_BOT).single();
    const settings = { ...(data?.settings as Record<string, unknown>), admin: adminBefore };
    await serviceDb().from("bots").update({ settings }).eq("id", DEMO_BOT);
    invalidateTenantDirectory();
  });

  it("владелец заводит менеджера, тот входит своим логином; пароль меняется, логин занят", async () => {
    await expect(
      saveTeamMember(ctx, { username: "x", role: "manager", password: "12345678" }),
    ).rejects.toThrow(/Логин/);
    await expect(saveTeamMember(ctx, { username: LOGIN, role: "manager" })).rejects.toThrow(
      /пароль/i,
    );
    await saveTeamMember(ctx, {
      username: LOGIN.toUpperCase(),
      name: "Маша",
      role: "manager",
      password: "manager-pass-1",
    });
    ctx = await fresh();
    expect(listTeam(ctx)).toEqual([
      expect.objectContaining({ username: LOGIN, name: "Маша", role: "manager" }),
    ]);

    // Без модуля «роли» логин команды не входит, хотя пользователь сохранён.
    expect(loginWithRoles(LOGIN, false)).toBeNull();
    const login = loginWithRoles(` ${LOGIN} `);
    expect(login?.tenant.id).toBe(DEMO_BOT);
    expect(login?.role).toBe("manager");
    expect(checkAdminPassword(login!, "manager-pass-1")).toBe(true);
    expect(checkAdminPassword(login!, "wrong")).toBe(false);
    const owner = await resolveAdminLogin("demo");
    expect(owner?.role).toBe("owner");

    // Смена роли без пароля — пароль прежний; занятый логин — отказ у другого магазина не проверить, у своего владельца — отказ.
    await saveTeamMember(ctx, { username: LOGIN, role: "viewer" });
    ctx = await fresh();
    expect(listTeam(ctx)[0]?.role).toBe("viewer");
    expect(checkAdminPassword(loginWithRoles(LOGIN)!, "manager-pass-1")).toBe(true);
    await expect(
      saveTeamMember(ctx, { username: "demo", role: "manager", password: "12345678" }),
    ).rejects.toThrow(/владельца/);

    await deleteTeamMember(ctx, LOGIN);
    ctx = await fresh();
    expect(listTeam(ctx)).toEqual([]);
    expect(loginWithRoles(LOGIN)).toBeNull();
    expect(await resolveAdminLogin(LOGIN)).toBeNull();
  });
});
