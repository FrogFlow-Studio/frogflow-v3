import { describe, expect, it } from "vitest";
import { decodeJwtPayload, mintTenantJwt, verifyTenantJwt } from "./jwt";

const BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7";
const SECRET = "super-secret-jwt-secret";

describe("tenant jwt", () => {
  it("подписывает claims роли tenant_bot с bot_id", () => {
    const token = mintTenantJwt(BOT, SECRET, 1_000_000);
    const payload = decodeJwtPayload(token);
    expect(payload).toMatchObject({
      role: "tenant_bot",
      bot_id: BOT,
      iss: "supabase",
      iat: 1_000_000,
    });
    expect(payload.exp).toBe(1_000_000 + 3600);
  });

  it("проверяет подпись и срок", () => {
    const now = Math.floor(Date.now() / 1000);
    const good = mintTenantJwt(BOT, SECRET, now);
    expect(verifyTenantJwt(good, SECRET)?.bot_id).toBe(BOT);
    expect(verifyTenantJwt(good, "other")).toBeNull();
    const expired = mintTenantJwt(BOT, SECRET, now - 7200);
    expect(verifyTenantJwt(expired, SECRET)).toBeNull();
  });

  it("отказывается подписывать не-UUID", () => {
    expect(() => mintTenantJwt("default", SECRET)).toThrow();
  });
});
