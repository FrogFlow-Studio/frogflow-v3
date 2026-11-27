import { describe, expect, it } from "vitest";
import { activeMemberCount } from "./pure";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const later = "2026-12-27T12:00:00Z";
const earlier = "2026-11-20T12:00:00Z";

describe("activeMemberCount — люди с действующим доступом", () => {
  it("считает только active с невышедшим сроком, человека — один раз", () => {
    expect(
      activeMemberCount(
        [
          { telegram_id: 1, status: "active", expires_at: later },
          { telegram_id: 1, status: "active", expires_at: later }, // продление
          { telegram_id: 2, status: "active", expires_at: later },
          { telegram_id: 3, status: "active", expires_at: earlier }, // крон ещё не прошёл
          { telegram_id: 4, status: "pending_payment", expires_at: later },
          { telegram_id: 5, status: "expired", expires_at: earlier },
          { telegram_id: 6, status: "cancelled", expires_at: null },
          { telegram_id: 7, status: "active", expires_at: null },
        ],
        NOW,
      ),
    ).toBe(2);
  });

  it("пустой список — ноль", () => {
    expect(activeMemberCount([], NOW)).toBe(0);
  });
});
