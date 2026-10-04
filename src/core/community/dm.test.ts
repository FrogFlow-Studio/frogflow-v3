import { describe, expect, it } from "vitest";
import { cleanDm, dmBlockedList, dmSpam, dmVerdict } from "./dm";

const a = (id: string, extra: Record<string, unknown> = {}, community: object = {}) => ({
  id,
  settings: {
    served_by: "v2" as const,
    community: { enabled: true, name: id, ...community },
    ...extra,
  },
});

describe("личные сообщения: правила", () => {
  it("согласный пишет согласному", () => {
    expect(dmVerdict(a("x"), a("y"))).toBe("ok");
  });
  it("несогласный не пишет; заблокированный оператором не пишет", () => {
    expect(dmVerdict({ id: "x", settings: { served_by: "v2" as const } }, a("y"))).toBe(
      "senderNotJoined",
    );
    expect(dmVerdict(a("x", { community_mod: { status: "blocked" } }), a("y"))).toBe(
      "senderNotJoined",
    );
  });
  it("адресат не в сообществе, скрыт или заблокирован оператором — писать нельзя", () => {
    expect(dmVerdict(a("x"), { id: "y", settings: { served_by: "v2" as const } })).toBe(
      "recipientUnavailable",
    );
    expect(dmVerdict(a("x"), a("y", { community_mod: { status: "hidden" } }))).toBe(
      "recipientUnavailable",
    );
    expect(dmVerdict(a("x"), a("y", { community_mod: { status: "blocked" } }))).toBe(
      "recipientUnavailable",
    );
    expect(dmVerdict(a("x"), null)).toBe("recipientUnavailable");
    expect(dmVerdict(a("x"), a("x"))).toBe("recipientUnavailable");
  });
  it("адресат запретил личные вообще или именно этому автору", () => {
    expect(dmVerdict(a("x"), a("y", {}, { dm_off: true }))).toBe("dmOff");
    expect(dmVerdict(a("x"), a("y", {}, { dm_blocked: ["x"] }))).toBe("blocked");
    expect(dmVerdict(a("z"), a("y", {}, { dm_blocked: ["x"] }))).toBe("ok");
  });
  it("список запретов чистится", () => {
    expect(dmBlockedList({ community: { dm_blocked: ["a", "a", "", 5 as never, "b"] } })).toEqual([
      "a",
      "b",
    ]);
    expect(dmBlockedList({})).toEqual([]);
  });
  it("текст и лимиты", () => {
    expect(cleanDm("  привет \n\n\n\n пока ")).toBe("привет\n\n пока");
    expect(cleanDm("   ")).toBeNull();
    expect(cleanDm(5)).toBeNull();
    expect(cleanDm("я".repeat(3000))).toHaveLength(2000);
    expect(dmSpam({ lastHour: 20, toThisAuthorLastHour: 0 })).toBe("hour");
    expect(dmSpam({ lastHour: 5, toThisAuthorLastHour: 5 })).toBe("pair");
    expect(dmSpam({ lastHour: 5, toThisAuthorLastHour: 4 })).toBe("ok");
  });
});
