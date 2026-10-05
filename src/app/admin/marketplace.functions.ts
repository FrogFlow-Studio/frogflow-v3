import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Согласие на площадку FrogFlow (core/marketplace): читают все сотрудники, меняет владелец. */
export const marketplaceFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/marketplace/settings.server")).marketplaceView(ctx);
});

export const saveMarketplaceListingFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ listed: z.boolean(), category: z.string().max(60), city: z.string().max(60) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("admin");
    return (await import("@/core/marketplace/settings.server")).saveMarketplaceListing(ctx, data);
  });

/** «Ваши переходы с площадки» за 30 дней; null — счётчика ещё нет. */
export const marketClicksFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/marketplace/analytics.server")).shopMarketClicks(ctx.tenant.id);
});
