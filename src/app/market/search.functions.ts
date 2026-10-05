import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  q: z.string().max(80).optional().catch(undefined),
  category: z.string().max(60).optional().catch(undefined),
  offset: z.number().int().min(0).max(100_000).optional().catch(undefined),
});

/**
 * Поиск товаров по всей площадке (В8). Публичный, без входа: в ответе только товары
 * согласных и одобренных магазинов. Таблицы нет (миграция 19-8 не применена) — `ready: false`.
 */
export const marketSearchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { searchMarketItems, itemFacets } = await import("@/core/marketplace/items.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    try {
      const [page, categories] = await Promise.all([
        searchMarketItems({ search: data.q, category: data.category, offset: data.offset }),
        itemFacets(),
      ]);
      return { ready: true as const, ...page, categories };
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { ready: false as const };
      throw e;
    }
  });
