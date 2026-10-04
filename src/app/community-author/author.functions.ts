import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/** Публичная страница автора (С6). Автор без согласия, скрытый или с прежней платформы — «не найден». */
export const authorPageFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug: z.string().regex(SHOP_SLUG_RE) }).parse(d))
  .handler(async ({ data }) => {
    const { authorPage } = await import("@/core/community/author-page.server");
    const page = await authorPage(data.slug);
    if (!page) throw notFound();
    return page;
  });

/** «Рекомендуем» на витрине: только взаимные рекомендации; сбой чтения — пусто, витрина не страдает. */
export const recommendedShopsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug: z.string().regex(SHOP_SLUG_RE) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { recommendedShops } = await import("@/core/community/author-page.server");
      return { shops: await recommendedShops(data.slug) };
    } catch (e) {
      console.error("recommendedShops failed", e);
      return { shops: [] };
    }
  });
