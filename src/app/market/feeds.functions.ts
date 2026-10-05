import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * «Недавно смотрели» на площадке (Л2), публичный, без входа: список приходит из браузера
 * покупателя, сервер ничего не пишет. Ленты «Новинки» и «Часто покупают» идут с поиском
 * (search.functions). Таблицы нет — пустой ответ.
 */
export const marketRecentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        views: z
          .array(z.object({ slug: z.string().regex(SHOP_SLUG_RE), id: z.string().uuid() }))
          .max(12),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (data.views.length === 0) return [];
    const { directoryShops } = await import("@/core/marketplace/items.server");
    const { recentItems } = await import("@/core/marketplace/feeds.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    try {
      return await recentItems(await directoryShops(), data.views);
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return [];
      throw e;
    }
  });
