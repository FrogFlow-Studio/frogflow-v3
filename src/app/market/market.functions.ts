import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  category: z.string().max(60).optional().catch(undefined),
  city: z.string().max(60).optional().catch(undefined),
  q: z.string().max(60).optional().catch(undefined),
  offset: z.number().int().min(0).max(100_000).optional().catch(undefined),
  lang: z.enum(["ru", "kk", "en", "uz"]).optional().catch(undefined),
});

/**
 * Страница /market: магазины площадки с фильтрами. Публичная, без входа и без данных
 * покупателей. Таблицы каталога нет (миграция 19-7 не применена) — `ready: false`.
 */
export const marketFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listMarketShops, marketFacets } = await import("@/core/marketplace/shops.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    try {
      const [page, facets] = await Promise.all([
        listMarketShops({
          category: data.category,
          city: data.city,
          search: data.q,
          offset: data.offset,
        }),
        marketFacets(),
      ]);
      // Подборки оператора — на первой странице без фильтров (Л3); нет таблицы — просто без них.
      const plain = !data.category && !data.city && !data.q && !data.offset;
      const collections = plain ? await readCollections(data.lang ?? "ru") : [];
      return { ready: true as const, ...page, ...facets, collections };
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { ready: false as const };
      throw e;
    }
  });

async function readCollections(locale: "ru" | "kk" | "en" | "uz") {
  const { publicCollections } = await import("@/core/marketplace/collections.server");
  const { directoryShops } = await import("@/core/marketplace/items.server");
  const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
  try {
    return await publicCollections(await directoryShops(), locale);
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return [];
    throw e;
  }
}
