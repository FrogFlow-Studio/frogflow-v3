import { describe, expect, it } from "vitest";
import { helpdeskTeam } from "./helpdesk.server";

describe("кому можно назначить обращение", () => {
  it("владелец и сотрудники с правом изменений; «просмотр» — нет", () => {
    const team = helpdeskTeam({
      settings: {
        admin: {
          username: "owner",
          users: [
            { username: "anna", password_hash: "x", role: "manager", name: "Анна" },
            { username: "buh", password_hash: "x", role: "viewer" },
          ],
        },
      },
    });
    expect(team).toEqual([
      { username: "owner", name: null },
      { username: "anna", name: "Анна" },
    ]);
    expect(helpdeskTeam({ settings: {} })).toEqual([]);
  });
});
