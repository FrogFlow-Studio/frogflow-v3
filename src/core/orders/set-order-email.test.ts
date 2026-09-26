import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setOrderEmail } from "./orders";

/** Цепочка update().eq().eq().select() → заданный ответ базы; запоминает, что писали. */
function ctxWith(result: { data: unknown; error: { message: string } | null }) {
  const calls: { patch?: unknown; eq: Array<[string, unknown]> } = { eq: [] };
  const chain = {
    eq(col: string, v: unknown) {
      calls.eq.push([col, v]);
      return chain;
    },
    select: async () => result,
  };
  const ctx = {
    db: {
      from: () => ({
        update(patch: unknown) {
          calls.patch = patch;
          return chain;
        },
      }),
    },
  } as unknown as TenantContext;
  return { ctx, calls };
}

describe("setOrderEmail", () => {
  it("пишет почту только в свой заказ покупателя", async () => {
    const { ctx, calls } = ctxWith({ data: [{ id: 7 }], error: null });
    expect(await setOrderEmail(ctx, 7, -42, "a@b.kz")).toBe(true);
    expect(calls.patch).toEqual({ customer_email: "a@b.kz" });
    expect(calls.eq).toEqual([
      ["id", 7],
      ["telegram_id", -42],
    ]);
  });

  it("ошибка базы — исключение, а не молчаливое «записал»", async () => {
    const { ctx } = ctxWith({ data: null, error: { message: "timeout" } });
    await expect(setOrderEmail(ctx, 7, -42, "a@b.kz")).rejects.toThrow(/timeout/);
  });

  it("чужой или удалённый заказ — false", async () => {
    const { ctx } = ctxWith({ data: [], error: null });
    expect(await setOrderEmail(ctx, 7, -42, "a@b.kz")).toBe(false);
  });
});
