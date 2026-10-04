import { describe, expect, it } from "vitest";
import type { AdminInvite } from "@/core/tenant/types";
import { INVITE_TTL_MS, inviteUsable, liveInvites } from "./staff-invite";

const NOW = Date.parse("2026-10-04T10:00:00Z");
const inv = (id: string, expiresIn: number): AdminInvite => ({
  id,
  hash: `h-${id}`,
  role: "manager",
  created_at: new Date(NOW - 1000).toISOString(),
  expires_at: new Date(NOW + expiresIn).toISOString(),
  by: "owner",
});

describe("приглашения в команду: срок", () => {
  it("действует 7 дней", () => {
    expect(INVITE_TTL_MS).toBe(7 * 86_400_000);
  });
  it("просроченное и ровно истекающее сейчас не действует", () => {
    expect(inviteUsable(inv("a", 1), NOW)).toBe(true);
    expect(inviteUsable(inv("a", 0), NOW)).toBe(false);
    expect(inviteUsable(inv("a", -5), NOW)).toBe(false);
  });
  it("живые отбираются, пустота — пустой список", () => {
    expect(liveInvites([inv("a", 5), inv("b", -5)], NOW).map((i) => i.id)).toEqual(["a"]);
    expect(liveInvites(undefined, NOW)).toEqual([]);
  });
});
