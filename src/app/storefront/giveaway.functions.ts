import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Страница итогов розыгрыша на витрине (модуль giveaways). Только клиенты v2
 * с включённым модулем, иначе 404. Имена победителей скрыты (core/giveaways/public).
 */
export const storeGiveawayFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ slug: z.string().regex(SHOP_SLUG_RE), id: z.string().max(16) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "giveaway")) throw notFound();
    const { publicGiveaway } = await import("@/core/giveaways/public");
    const g = await publicGiveaway(tenantContext(t), data.id);
    if (!g) throw notFound();
    return g;
  });
