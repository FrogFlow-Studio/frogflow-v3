import { afterEach, describe, expect, it } from "vitest";
import { env, setEnvForTests } from "./env";

afterEach(() => setEnvForTests(undefined));

describe("APP_TIMEZONE", () => {
  it("не задан — Asia/Almaty", () => {
    setEnvForTests({});
    expect(env().APP_TIMEZONE).toBe("Asia/Almaty");
  });

  it("пустая строка в Vercel — Asia/Almaty, а не «Invalid time zone» в аналитике", () => {
    setEnvForTests({ APP_TIMEZONE: "" });
    expect(env().APP_TIMEZONE).toBe("Asia/Almaty");
    setEnvForTests({ APP_TIMEZONE: "  " });
    expect(env().APP_TIMEZONE).toBe("Asia/Almaty");
  });

  it("опечатка — Asia/Almaty; верный пояс — как есть, без пробелов", () => {
    setEnvForTests({ APP_TIMEZONE: "Asia/Almata" });
    expect(env().APP_TIMEZONE).toBe("Asia/Almaty");
    setEnvForTests({ APP_TIMEZONE: " Europe/Moscow " });
    expect(env().APP_TIMEZONE).toBe("Europe/Moscow");
    expect(() => new Intl.DateTimeFormat("ru", { timeZone: env().APP_TIMEZONE })).not.toThrow();
  });
});
