import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";

// API оператора /api/operator/bots: при включённом двухшаговом входе пароля мало.
let second: "none" | "totp" | null = null;
const seen: Array<string | undefined> = [];
vi.mock("@/app/operator/credentials.server", () => ({ verifyOperator: async () => true }));
vi.mock("@/app/operator/two-factor.server", () => ({
  verifySecondFactor: async (code: string | undefined) => {
    seen.push(code);
    return second;
  },
}));
vi.mock("@/app/auth/login-guard.server", () => ({
  clientIp: () => "127.0.0.1",
  loginDelay: async () => undefined,
  loginLocked: async () => false,
  recordLogin: async () => undefined,
}));

// Без ключей живой базы окружение пустое: маршрут читает env() до проверки входа.
setEnvForTests({});

const { Route } = await import("@/routes/api/operator/bots");
const post = (
  Route.options as unknown as {
    server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;

function call(otp?: string) {
  return post({
    request: new Request("https://x/api/operator/bots", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from("operator:pass").toString("base64"),
        ...(otp ? { "x-operator-otp": otp } : {}),
      },
      body: "не json",
    }),
  });
}

beforeEach(() => {
  seen.length = 0;
});

describe("API оператора и двухшаговый вход", () => {
  it("2FA включён: без кода или с неверным — 401, к данным не доходит", async () => {
    second = null;
    const r = await call();
    expect(r.status).toBe(401);
    expect(r.headers.get("x-operator-otp")).toBe("required");
    expect((await call("000000")).status).toBe(401);
    expect(seen).toEqual([undefined, "000000"]);
  });

  it("верный код или 2FA выключен — запрос идёт дальше (здесь — 400 на кривое тело)", async () => {
    second = "totp";
    expect((await call("123456")).status).toBe(400);
    second = "none";
    expect((await call()).status).toBe(400);
  });
});
