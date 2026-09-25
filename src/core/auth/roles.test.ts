import { describe, expect, it } from "vitest";
import { adminLoginTaken, findAdminLogin, roleAllows } from "./roles";
import type { Tenant } from "@/core/tenant/types";

const tenant = (id: string, admin: Tenant["settings"]["admin"], archived = false) =>
  ({
    id,
    name: id,
    archived,
    settings: { admin },
    modules: {},
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
