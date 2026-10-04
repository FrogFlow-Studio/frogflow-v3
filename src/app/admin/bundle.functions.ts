import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/** Наборы товаров (модуль bundles): состав набора в карточке товара. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("bundles", min);

const uuid = z.string().uuid();

/** Состав набора с состоянием каждой позиции и выгодой; не набор — `view: null`. */
export const productBundleFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { bundleView } = await import("@/core/bundles/bundle");
    return { view: await bundleView(ctx, data.id) };
  });

/** Товар для добавления в набор: название, физический ли он, его варианты. */
export const bundleComponentFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { bundleComponentInfo } = await import("@/core/bundles/bundle");
    return { component: await bundleComponentInfo(ctx, data.id) };
  });

export const saveProductBundleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid,
        items: z
          .array(
            z.object({
              productId: uuid,
              variantId: uuid.nullable(),
              qty: z.number().int().min(1).max(99),
            }),
          )
          .max(20)
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveBundle, bundleView } = await import("@/core/bundles/bundle");
    const saved = await saveBundle(ctx, data.id, data.items);
    return { view: saved ? await bundleView(ctx, data.id, saved) : null };
  });

/**
 * Упаковочный лист заказа: состав, получатель, открытка, отметка об упаковке —
 * без цен и контактов. Бухгалтеру закрыт (moduleAdmin отказывает ему, как и везде).
 */
export const packingSlipFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { buildPackingSlip } = await import("@/core/orders/packing-slip");
    const slip = await buildPackingSlip(ctx, data.id);
    if (!slip) throw new UserError("err.admin.orderNotFound", "Заказ не найден");
    return { slip };
  });
