import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Подарочная упаковка (core/orders/gift-wrap, модуль bundles): читают все сотрудники, меняет владелец. */
export const giftWrapFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdminModule("bundles");
  const { loadGiftWrap } = await import("@/core/orders/gift-wrap");
  const { shopCurrency } = await import("@/core/discounts/discounts");
  const { giftAskOn } = await import("@/core/orders/gift");
  return {
    ...(await loadGiftWrap(ctx)),
    currency: await shopCurrency(ctx),
    ask: await giftAskOn(ctx),
  };
});

export const saveGiftWrapFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        on: z.boolean(),
        price: z.number().min(0).max(100_000_000),
        ask: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("bundles", "admin");
    const { saveGiftWrap, loadGiftWrap } = await import("@/core/orders/gift-wrap");
    // Включить упаковку без цены нельзя: покупателю предложили бы её за 0.
    if (data.on && !(data.price > 0)) {
      const { UserError } = await import("@/core/i18n/user-error");
      throw new UserError(
        "err.giftWrap.noPrice",
        "Чтобы включить упаковку, укажите цену больше нуля.",
      );
    }
    await saveGiftWrap(ctx, data);
    const { saveGiftAsk, giftAskOn } = await import("@/core/orders/gift");
    if (data.ask !== undefined) await saveGiftAsk(ctx, data.ask);
    return { ...(await loadGiftWrap(ctx)), ask: await giftAskOn(ctx) };
  });
