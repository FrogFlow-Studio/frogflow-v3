import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Отзывы на странице товара (core/reviews/photos): только одобренные
 * продавцом, постранично, с фильтрами «с фото» и по оценке; только витрина клиента v2 с открытым каталогом. Отдельно от
 * storefront.functions — код оформления заказа не трогаем.
 */
export const storeReviewsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        id: z.string().uuid(),
        rating: z.number().int().min(1).max(5).optional(),
        withPhoto: z.boolean().optional(),
        offset: z.number().int().min(0).max(5000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { approvedReviewsPage } = await import("@/core/reviews/photos.server");
    return approvedReviewsPage(tenantContext(t), data.id, {
      rating: data.rating,
      withPhoto: data.withPhoto,
      offset: data.offset,
    });
  });
