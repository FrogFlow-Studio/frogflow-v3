import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Себестоимость товаров (модуль `profit`, Pro и Business). Видит и правит
 * бухгалтер — это его цифры, поэтому функции открыты ему через
 * requireAdminFinance (запись — не для роли «просмотр»). Себестоимость не
 * содержит данных покупателей, прятать в ответе нечего.
 */
const uuid = z.string().uuid();

async function costShop(edit: boolean) {
  const { ctx } = await (await import("@/app/auth/guards.server")).requireAdminFinance({ edit });
  if (!ctx.tenant.modules.profit) {
    const { UserError } = await import("@/core/i18n/user-error");
    throw new UserError("err.auth.moduleOff", "Модуль «{module}» не подключён к вашему тарифу.", {
      module: "profit",
    });
  }
  return ctx;
}

/** Страница «Себестоимость»: все товары с заданной себестоимостью. */
export const costListFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await costShop(false);
  const { listCostRows } = await import("@/core/profit/cost");
  return listCostRows(ctx);
});

/** Карточка товара: себестоимость одного товара и его вариантов. */
export const productCostFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await costShop(false);
    const { loadCost } = await import("@/core/profit/cost");
    const { shopCurrency } = await import("@/core/discounts/discounts");
    const currency = await shopCurrency(ctx);
    const cost = await loadCost(ctx, data.id);
    return { currency, cost: cost && cost.currency === currency ? cost : null };
  });

const amount = z.number().min(0).max(1_000_000_000).nullable();

export const saveCostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid,
        price: amount.optional(),
        variants: z.record(z.string().min(1).max(200), amount).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await costShop(true);
    const { saveCost } = await import("@/core/profit/cost");
    const cost = await saveCost(ctx, data.id, { price: data.price, variants: data.variants });
    return { cost };
  });
