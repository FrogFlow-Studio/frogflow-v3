import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Апсейл (модуль upsell): что предлагать в корзине вместе с этим товаром. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("upsell", min);

export const upsellForProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { getUpsellFor } = await import("@/core/upsell/upsell");
    const { productsByIds } = await import("@/core/catalog/picker");
    const selected = await getUpsellFor(ctx, data.productId);
    // Названия выбранных; новые добавляются поиском (productPickerFn).
    const products = await productsByIds(ctx, selected);
    return { selected, products };
  });

export const saveUpsellFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ productId: z.string().uuid(), ids: z.array(z.string().uuid()).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { setUpsellFor } = await import("@/core/upsell/upsell");
    await setUpsellFor(ctx, data.productId, data.ids);
    return { ok: true };
  });
