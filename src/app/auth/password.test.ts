import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("хеш проверяется, чужой пароль и мусор — нет", () => {
    const h = hashPassword("секрет-123");
    expect(h.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("секрет-123", h)).toBe(true);
    expect(verifyPassword("секрет-124", h)).toBe(false);
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "plain")).toBe(false);
    expect(hashPassword("a")).not.toBe(hashPassword("a"));
  });
});
