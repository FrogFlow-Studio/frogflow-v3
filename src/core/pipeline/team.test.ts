import { describe, expect, it } from "vitest";
import type { Tenant } from "@/core/tenant/types";
import { teamLogins } from "./team";

const tenant = (admin_roles: boolean) =>
  ({
    modules: { admin_roles },
    settings: {
      admin: {
        username: "owner",
        users: [
          { username: "manager1", role: "manager" },
          { username: "viewer1", role: "viewer" },
        ],
      },
    },
  }) as unknown as Tenant;

describe("ответственные в воронке", () => {
  it("владелец и команда, пока подключены роли", () => {
    expect(teamLogins(tenant(true))).toEqual(["owner", "manager1", "viewer1"]);
  });
  it("без модуля ролей — только владелец", () => {
    expect(teamLogins(tenant(false))).toEqual(["owner"]);
  });
});
