import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Отзывы на странице товара (core/reviews/photos): только одобренные
 * продавцом, только витрина клиента v2 с открытым каталогом. Отдельно от
 * storefront.functions — код оформления заказа не трогаем.
 */
export const storeReviewsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ slug: z.string().regex(SHOP_SLUG_RE), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { approvedReviews } = await import("@/core/reviews/photos.server");
    return approvedReviews(tenantContext(t), data.id);
  });
