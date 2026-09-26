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
    const [selected, products] = await Promise.all([
      getUpsellFor(ctx, data.productId),
      ctx.db
        .from("products")
        .select("id, name")
        .eq("is_active", true)
        .neq("id", data.productId)
        .order("name")
        .limit(500)
        .then((r) => r.data ?? []),
    ]);
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
