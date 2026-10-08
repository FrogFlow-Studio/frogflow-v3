import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { isPlatformFailure, panelOf, reportServerFnFailure } from "./server-fn-errors";

describe("isPlatformFailure: что считать сбоем платформы", () => {
  it("сбои — да", () => {
    expect(isPlatformFailure(new TypeError("Cannot read properties of undefined"))).toBe(true);
    expect(isPlatformFailure(new Error("Zernio API 500: boom"))).toBe(true);
    expect(isPlatformFailure(new Error("zernio_logs: duplicate key value"))).toBe(true);
    expect(isPlatformFailure("string thrown")).toBe(true);
  });
  it("отказы человеку — нет", () => {
    expect(
      isPlatformFailure(new UserError("orders.notFound", "Заказ #{no} не найден", { no: 1 })),
    ).toBe(false);
    expect(isPlatformFailure(new ZodError([]))).toBe(false);
    expect(isPlatformFailure(new Error("Публикация не найдена среди ваших."))).toBe(false);
    expect(isPlatformFailure(Object.assign(new Error("Unauthorized"), { role: "admin" }))).toBe(
      false,
    );
    expect(isPlatformFailure({ isRedirect: true })).toBe(false);
    expect(isPlatformFailure(new Response(null, { status: 302 }))).toBe(false);
  });
  it("подкласс Error с русским текстом — всё равно сбой: так пишут только обычные отказы", () => {
    expect(isPlatformFailure(new RangeError("Неверная дата"))).toBe(true);
  });
});

describe("reportServerFnFailure", () => {
  const meta = { name: "saveProductFn", filename: "src/app/admin/products.functions.ts" };

  it("сбой уходит в учёт с панелью, функцией и клиентом и пробрасывается как был", async () => {
    const seen: unknown[] = [];
    const boom = new Error("relation does not exist");
    await expect(
      reportServerFnFailure(
        { next: () => Promise.reject(boom), serverFnMeta: meta },
        { botId: async () => "bot-1", report: async (e, c) => void seen.push([e, c]) },
      ),
    ).rejects.toBe(boom);
    expect(seen).toEqual([
      [boom, { where: "serverFn:admin", botId: "bot-1", extra: { fn: "saveProductFn" } }],
    ]);
  });

  it("отказ человеку не репортится; успех проходит как есть", async () => {
    let n = 0;
    const report = async () => void n++;
    const refusal = new UserError("x", "Нет прав");
    await expect(
      reportServerFnFailure(
        { next: () => Promise.reject(refusal), serverFnMeta: meta },
        { report },
      ),
    ).rejects.toBe(refusal);
    expect(await reportServerFnFailure({ next: async () => 42 }, { report })).toBe(42);
    expect(n).toBe(0);
  });

  it("панель оператора — без клиента; сбой учёта не подменяет ошибку", async () => {
    const seen: unknown[] = [];
    const boom = new Error("timeout");
    await expect(
      reportServerFnFailure(
        {
          next: () => Promise.reject(boom),
          serverFnMeta: { name: "x", filename: "src/app/operator/clients.functions.ts" },
        },
        {
          botId: async () => "never",
          report: async (_e, c) => {
            seen.push(c.botId);
            throw new Error("sentry down");
          },
        },
      ),
    ).rejects.toBe(boom);
    expect(seen).toEqual([null]);
    expect(panelOf(undefined)).toBe("app");
  });
});
