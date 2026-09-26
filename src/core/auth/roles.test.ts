import { describe, expect, it } from "vitest";
import { adminLoginTaken, findAdminLogin, loginInTenant, roleAllows } from "./roles";
import type { Tenant } from "@/core/tenant/types";

const tenant = (
  id: string,
  admin: Tenant["settings"]["admin"],
  archived = false,
  modules: Partial<Tenant["modules"]> = { admin_roles: true },
) =>
  ({
    id,
    name: id,
    archived,
    settings: { admin },
    modules,
    status: "active",
  }) as unknown as Tenant;

const shops = [
  tenant("a", {
    username: "anna",
    password_hash: "h-anna",
    users: [{ username: "manager1", password_hash: "h-m", role: "manager", name: "Маша" }],
  }),
  tenant("b", { username: "bob", password_hash: "h-bob" }),
  tenant("z", { username: "zombie", password_hash: "h-z" }, true),
];

describe("роли админки", () => {
  it("владелец может всё, менеджер — не настройки, просмотр — ничего не меняет", () => {
    expect(roleAllows("owner", "owner")).toBe(true);
    expect(roleAllows("manager", "owner")).toBe(false);
    expect(roleAllows("manager", "manager")).toBe(true);
    expect(roleAllows("viewer", "manager")).toBe(false);
    expect(roleAllows("viewer", "viewer")).toBe(true);
    expect(roleAllows(undefined, "owner")).toBe(true); // старая сессия без роли — владелец
  });
  it("логин находит магазин и роль; регистр и пробелы не мешают; архив не входит", () => {
    expect(findAdminLogin(shops, " Anna ")).toMatchObject({
      role: "owner",
      passwordHash: "h-anna",
    });
    expect(findAdminLogin(shops, "MANAGER1")).toMatchObject({
      role: "manager",
      passwordHash: "h-m",
      name: "Маша",
    });
    expect(findAdminLogin(shops, "manager1")?.tenant.id).toBe("a");
    expect(findAdminLogin(shops, "zombie")).toBeNull();
    expect(findAdminLogin(shops, "")).toBeNull();
  });
  it("занятость логина учитывает владельцев и пользователей всех магазинов, кроме самого себя", () => {
    expect(adminLoginTaken(shops, "bob")).toBe(true);
    expect(adminLoginTaken(shops, "manager1")).toBe(true);
    expect(adminLoginTaken(shops, "new_one")).toBe(false);
    expect(adminLoginTaken(shops, "manager1", { botId: "a", username: "manager1" })).toBe(false);
    expect(adminLoginTaken(shops, "manager1", { botId: "b", username: "manager1" })).toBe(true);
    expect(adminLoginTaken(shops, "anna", { botId: "a", username: "anna" })).toBe(false);
  });
});

describe("сессия сверяется с текущей командой", () => {
  it("удалённый пользователь теряет доступ, пониженный получает новую роль", () => {
    expect(loginInTenant(shops[0]!, "manager1")?.role).toBe("manager");
    const demoted = tenant("a", {
      username: "anna",
      password_hash: "h-anna",
      users: [{ username: "manager1", password_hash: "h-m", role: "viewer" }],
    });
    expect(loginInTenant(demoted, "manager1")?.role).toBe("viewer");
    const removed = tenant("a", { username: "anna", password_hash: "h-anna", users: [] });
    expect(loginInTenant(removed, "manager1")).toBeNull();
  });

  it("логин другого магазина и учётка без пароля не подходят", () => {
    expect(loginInTenant(shops[0]!, "bob")).toBeNull();
    expect(loginInTenant(tenant("c", { username: "nopass" }), "nopass")).toBeNull();
    expect(loginInTenant(shops[0]!, "anna")?.role).toBe("owner");
  });
});

describe("команда — платный модуль admin_roles", () => {
  it("без модуля входит только владелец, но логины команды остаются занятыми", () => {
    const off = tenant(
      "a",
      {
        username: "anna",
        password_hash: "h-anna",
        users: [{ username: "manager1", password_hash: "h-m", role: "manager" }],
      },
      false,
      {},
    );
    expect(findAdminLogin([off], "manager1")).toBeNull();
    expect(loginInTenant(off, "manager1")).toBeNull();
    expect(loginInTenant(off, "anna")?.role).toBe("owner");
    expect(adminLoginTaken([off], "manager1")).toBe(true);
  });
});
