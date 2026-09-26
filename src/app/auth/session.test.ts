import { describe, expect, it } from "vitest";
import { credentialStamp } from "./session.server";

describe("credentialStamp", () => {
  it("меняется со сменой пароля и не содержит сам хеш", () => {
    const a = credentialStamp("admin", "bot", "anna", "scrypt$hash1");
    expect(a).toBe(credentialStamp("admin", "bot", "anna", "scrypt$hash1"));
    expect(a).not.toBe(credentialStamp("admin", "bot", "anna", "scrypt$hash2"));
    expect(a).not.toBe(credentialStamp("admin", "bot2", "anna", "scrypt$hash1"));
    expect(a).not.toContain("hash1");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
  it("разделитель не даёт склеить части по-другому", () => {
    expect(credentialStamp("ab", "c")).not.toBe(credentialStamp("a", "bc"));
  });
});
