import { describe, expect, it } from "vitest";
import { clientIp } from "./login-guard.server";

describe("clientIp вне серверной функции", () => {
  it("берёт первый адрес из x-forwarded-for", () => {
    const r = new Request("https://x.test", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(r)).toBe("203.0.113.7");
  });
  it("без заголовков — null (попытки считаются в общем ведре)", () => {
    expect(clientIp(new Request("https://x.test"))).toBeNull();
  });
});
