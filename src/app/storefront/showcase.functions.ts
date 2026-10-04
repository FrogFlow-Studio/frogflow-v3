import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Блоки главной витрины (core/storefront/design): новинки, хиты, наборы, отзывы
 * в порядке, который выбрал продавец. Без выбранных блоков — пустой ответ, главная как раньше.
 */
export const storeShowcaseFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug: z.string().regex(SHOP_SLUG_RE) }).parse(d))
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { showcase } = await import("@/core/storefront/showcase.server");
    return showcase(tenantContext(t));
  });
