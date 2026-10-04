import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "./server-failure";
import { failureFields, logFailure, requestId } from "./log-failure";

const TOKEN = "a1b2c3d4".repeat(4);
const BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9";

afterEach(() => vi.restoreAllMocks());

describe("единая строка об ошибке функции (Л1)", () => {
  it("ровно пять полей: имя, магазин, код, номер запроса, сообщение", () => {
    const f = failureFields("support.notifyOperator", new Error("boom"), { botId: "b1" });
    expect(Object.keys(f)).toEqual(["fn", "bot_id", "code", "req", "msg"]);
    expect(f).toMatchObject({
      fn: "support.notifyOperator",
      bot_id: "b1",
      code: "Error",
      msg: "boom",
    });
    expect(f.req).toMatch(/^[0-9a-f]{8}$/);
    expect(requestId()).not.toBe(requestId());
  });

  it("код: ключ UserError, код базы или сети, имя ошибки; чужой мусор — «error»", () => {
    expect(failureFields("f", new UserError("err.x", "т")).code).toBe("err.x");
    expect(failureFields("f", Object.assign(new Error("x"), { code: "23505" })).code).toBe("23505");
    expect(failureFields("f", Object.assign(new Error("x"), { code: "ETIMEDOUT" })).code).toBe(
      "ETIMEDOUT",
    );
    expect(failureFields("f", serverFailure("x")).code).toBe("ServerFailure");
    expect(failureFields("f", { code: "a b\nc" }).code).toBe("error");
    expect(failureFields("f", "строка").msg).toBe("строка");
    expect(failureFields("f", { secret: "s" }).msg).toBe("");
    expect(failureFields("f", new Error("x"), { code: "custom.code" }).code).toBe("custom.code");
  });

  it("в сообщении нет токена бота, подписи ссылки заказа, Bearer и почты покупателя", () => {
    const e = new Error(
      `bot${BOT_TOKEN} https://s.test/order/9?t=${TOKEN} Authorization: Bearer abcdef1234567890 письмо ivan@example.com не ушло`,
    );
    const line = JSON.stringify(failureFields("f", e));
    for (const secret of [BOT_TOKEN, TOKEN, "abcdef1234567890", "ivan@"])
      expect(line).not.toContain(secret);
    expect(line).toContain("i***@example.com");
  });

  it("сообщение одной строкой и не длиннее 200 знаков; стека нет", () => {
    const f = failureFields("f", new Error(`а\n\nб ${"я".repeat(500)}`));
    expect(f.msg.includes("\n")).toBe(false);
    expect(f.msg.length).toBeLessThanOrEqual(201);
    expect(JSON.stringify(f)).not.toMatch(/\bat \w+.*:\d+:\d+/);
  });

  it("logFailure пишет одну строку `[fail] {json}` и отдаёт номер запроса", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = logFailure("market.track", new Error("x"), { req: "deadbeef" });
    expect(req).toBe("deadbeef");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line.startsWith("[fail] ")).toBe(true);
    expect(JSON.parse(line.slice(7))).toEqual({
      fn: "market.track",
      bot_id: null,
      code: "Error",
      req: "deadbeef",
      msg: "x",
    });
  });
});

/** Места 19-й, переведённые на единую запись: сырого `console.error(…, e)` в них больше нет. */
const CONVERTED = [
  "src/app/admin/support.functions.ts",
  "src/app/admin/community-dm.server.ts",
  "src/app/admin/community-promos.server.ts",
  "src/app/admin/helpdesk.server.ts",
  "src/app/market/track.functions.ts",
  "src/app/community-author/author.functions.ts",
  "src/app/preorder/notify.server.ts",
  "src/app/payments/unapplied-payment.server.ts",
  "src/core/orders/batch.ts",
];

describe("тест-скан: сырой вывод ошибок и запрещённые поля", () => {
  it("переведённые места пишут через logFailure, а не console.error с объектом ошибки", () => {
    for (const f of CONVERTED) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/console\.error\(/);
      expect(src, f).toContain("logFailure(");
    }
  });

  it("вызовы logFailure передают только botId, code и req — ни токена, ни тела запроса", () => {
    const FORBIDDEN = /\b(token|secret|api_?key|password|body|headers|cookie|email|phone)\b\s*:/i;
    for (const f of CONVERTED) {
      for (const m of readFileSync(f, "utf8").matchAll(/logFailure\([^;]*?\)/gs))
        expect(m[0], f).not.toMatch(FORBIDDEN);
    }
  });

  it("сам помощник не выводит ничего, кроме пяти полей", () => {
    const src = readFileSync("src/lib/log-failure.ts", "utf8");
    expect(src.match(/console\./g)).toHaveLength(1);
    expect(src).not.toMatch(/\.stack|JSON\.stringify\((e|err)\b/);
  });
});
