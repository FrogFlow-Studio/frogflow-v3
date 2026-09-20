import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "./init-data";

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

describe("telegram initData", () => {
  it("принимает подписанные данные и достаёт пользователя", () => {
    const now = 1_800_000_000;
    const init = signInitData(
      {
        auth_date: String(now - 10),
        query_id: "q",
        user: JSON.stringify({ id: 42, first_name: "A" }),
      },
      TOKEN,
    );
    const r = validateInitData(init, TOKEN, 3600, now);
    expect(r.ok && r.user.id).toBe(42);
  });

  it("отвергает чужой токен, подделку и просрочку", () => {
    const now = 1_800_000_000;
    const init = signInitData(
      { auth_date: String(now - 10), user: JSON.stringify({ id: 1 }) },
      TOKEN,
    );
    expect(validateInitData(init, "other:token", 3600, now).ok).toBe(false);
    expect(
      validateInitData(init.replace("%22id%22%3A1", "%22id%22%3A2"), TOKEN, 3600, now).ok,
    ).toBe(false);
    expect(validateInitData(init, TOKEN, 3600, now + 7200)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(validateInitData("", TOKEN)).toEqual({ ok: false, reason: "missing" });
  });
});
