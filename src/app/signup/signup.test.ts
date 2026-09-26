import { describe, expect, it } from "vitest";
import { SIGNUP_LIMITS, ipHash, signupVerdict } from "./signup.server";

describe("лимит регистрации", () => {
  it("пропускает, пока лимиты не выбраны", () => {
    expect(signupVerdict({ ip: 0, total: 0 })).toBeNull();
    expect(signupVerdict({ ip: SIGNUP_LIMITS.perIpPerDay - 1, total: 5 })).toBeNull();
  });
  it("отказывает по адресу и по общему числу за сутки", () => {
    expect(signupVerdict({ ip: SIGNUP_LIMITS.perIpPerDay, total: 0 })).toMatch(/адреса/);
    expect(signupVerdict({ ip: 0, total: SIGNUP_LIMITS.totalPerDay })).toMatch(/закрыта/);
  });
  it("адрес в журнал не пишется как есть", () => {
    expect(ipHash("203.0.113.7")).not.toContain("203");
    expect(ipHash("203.0.113.7")).toBe(ipHash("203.0.113.7"));
    expect(ipHash(null)).not.toBe(ipHash("203.0.113.7"));
  });
});
