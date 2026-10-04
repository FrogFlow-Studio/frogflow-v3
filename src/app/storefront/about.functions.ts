import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Страница «О магазине»: слова продавца и свежие одобренные отзывы. Пока продавец
 * ничего не заполнил, страницы нет — 404, как у любой несуществующей.
 */
export const storeAboutPageFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug: z.string().regex(SHOP_SLUG_RE) }).parse(d))
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { aboutPage } = await import("@/core/storefront/about.server");
    const { aboutFilled } = await import("@/core/storefront/about");
    const page = await aboutPage(tenantContext(t));
    if (!aboutFilled(page.about)) throw notFound();
    return page;
  });
