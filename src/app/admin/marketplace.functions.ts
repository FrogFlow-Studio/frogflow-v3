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
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
    return (await import("@/core/marketplace/settings.server")).saveMarketplaceListing(ctx, data);
  });
