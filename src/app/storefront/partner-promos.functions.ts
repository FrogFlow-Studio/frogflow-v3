import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * «Акция партнёров» на витрине (core/community/joint.server). Публичная: отдаёт только то, что
 * покупателю нужно (название акции, до какого числа, промокоды, имена и адреса витрин участников).
 * Нет магазина, клиент прежней платформы или таблиц ещё нет — пустой список, а не ошибка.
 */
export const partnerPromosFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug: z.string().regex(SHOP_SLUG_RE) }).parse(d))
  .handler(async ({ data }) => {
    const { resolveTenant } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "info")) return { banners: [] };
    try {
      const { partnerBanners } = await import("@/core/community/joint.server");
      return { banners: await partnerBanners({ tenant: t }) };
    } catch (e) {
      const { CommunityNotReady } = await import("@/core/community/not-ready");
      if (e instanceof CommunityNotReady) return { banners: [] };
      throw e;
    }
  });
