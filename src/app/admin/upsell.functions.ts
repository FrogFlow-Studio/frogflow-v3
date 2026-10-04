import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Апсейл (модуль upsell): что предлагать в корзине вместе с этим товаром. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("upsell", min);

export const upsellForProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { upsellTargets } = await import("@/core/upsell/upsell");
    // Выбранные с состоянием (в продаже, скрыт, удалён); новые добавляются поиском (productPickerFn).
    return { targets: await upsellTargets(ctx, data.productId) };
  });

/** Правила, которые не работают: предлагаемый товар скрыт или удалён, либо удалён товар правила. */
export const upsellHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { upsellHealth } = await import("@/core/upsell/upsell");
  return upsellHealth(ctx);
});

/** «Убрать удалённые»: скрытые товары правил остаются — их могут вернуть в продажу. */
export const pruneUpsellFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await moduleAdmin("manager");
  const { pruneUpsellRules } = await import("@/core/upsell/upsell");
  return { removed: await pruneUpsellRules(ctx) };
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
