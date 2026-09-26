import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

const SECRET = "cron-secret-cron-secret-0000";
const req = (headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/cron/health", { headers });

describe("isCronAuthorized: доступ к /api/cron/*", () => {
  it("пропускает верный Bearer-заголовок", () => {
    expect(isCronAuthorized(req({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
  });

  it("отклоняет неверный секрет в заголовке", () => {
    expect(
      isCronAuthorized(req({ authorization: "Bearer wrong-secret-wrong-secret" }), SECRET),
    ).toBe(false);
    expect(isCronAuthorized(req({ authorization: `Bearer ${SECRET}x` }), SECRET)).toBe(false);
    expect(isCronAuthorized(req({ authorization: SECRET }), SECRET)).toBe(false);
  });

  it("отклоняет запрос вовсе без секрета", () => {
    expect(isCronAuthorized(req(), SECRET)).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Bearer " }), SECRET)).toBe(false);
  });

  it("пустой секрет деплоя не открывает кроны — fail closed", () => {
    expect(isCronAuthorized(req(), "")).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Bearer " }), "")).toBe(false);
    expect(isCronAuthorized(req({ authorization: "Bearer anything" }), "")).toBe(false);
  });

  it("голый заголовок x-vercel-cron не считается авторизацией", () => {
    expect(isCronAuthorized(req({ "x-vercel-cron": "1" }), SECRET)).toBe(false);
    expect(isCronAuthorized(req({ "user-agent": "vercel-cron/1.0" }), SECRET)).toBe(false);
  });
});
