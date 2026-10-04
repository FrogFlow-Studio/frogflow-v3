import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { CATALOG_SORTS } from "@/core/storefront/sort";
import { FAVORITES_MAX } from "@/core/storefront/favorites";

/**
 * Каталог витрины страницами (core/storefront/catalog, storeCatalogPage):
 * весь каталог без потолка в 200 товаров, «Показать ещё» догружает дальше.
 * Отдельно от storefront.functions — код оформления заказа не трогаем.
 */
export const storeCatalogPageFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        q: z.string().max(80).optional(),
        category: z.string().uuid().optional(),
        sort: z.enum(CATALOG_SORTS).optional(),
        lang: z.string().max(5).optional(),
        stock: z.boolean().optional(),
        sale: z.boolean().optional(),
        bundles: z.boolean().optional(),
        min: z.number().min(0).max(1_000_000_000).optional(),
        max: z.number().min(0).max(1_000_000_000).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    // Клиент прежней платформы, архив или витрина без модуля — «не найден».
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { storeCatalogPage } = await import("@/core/storefront/catalog");
    return storeCatalogPage(tenantContext(t), {
      q: data.q,
      categoryId: data.category ?? null,
      sort: data.sort,
      lang: data.lang,
      inStock: data.stock,
      sale: data.sale,
      bundles: data.bundles,
      minPrice: data.min,
      maxPrice: data.max,
      offset: data.offset,
    });
  });

/**
 * Избранное витрины: id товаров из браузера покупателя → карточки (core/storefront/catalog,
 * storeProductsByIds). Исчезнувших в ответе нет — страница убирает их у себя.
 */
export const storeFavoritesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        ids: z.array(z.string().uuid()).max(FAVORITES_MAX),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { storeProductsByIds } = await import("@/core/storefront/catalog");
    return storeProductsByIds(tenantContext(t), data.ids);
  });
