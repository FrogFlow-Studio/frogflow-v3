import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Минимальная сумма заказа магазина (core/cart/min-order): читают все сотрудники, меняет владелец. */
export const minOrderFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  const { loadMinOrder } = await import("@/core/cart/min-order");
  const { shopCurrency } = await import("@/core/discounts/discounts");
  return { amount: await loadMinOrder(ctx), currency: await shopCurrency(ctx) };
});

export const saveMinOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ amount: z.number().min(0).max(100_000_000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("admin");
    const { saveMinOrder } = await import("@/core/cart/min-order");
    await saveMinOrder(ctx, data.amount);
    return { ok: true };
  });
