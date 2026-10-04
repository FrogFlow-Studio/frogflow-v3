import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  category: z.string().max(60).optional().catch(undefined),
  city: z.string().max(60).optional().catch(undefined),
  q: z.string().max(60).optional().catch(undefined),
  offset: z.number().int().min(0).max(100_000).optional().catch(undefined),
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
      return { ready: true as const, ...page, ...facets };
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { ready: false as const };
      throw e;
    }
  });
