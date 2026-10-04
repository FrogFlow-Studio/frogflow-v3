import type { TenantContext } from "@/core/tenant/resolve.server";
import { recentApprovedReviews, type RecentReview } from "@/core/reviews/recent.server";
import { storeCatalogPage, type StoreProduct } from "./catalog";
import { BLOCK_SIZE, parseDesign, type StoreBlock } from "./design";

export type ShowcaseSection =
  | { key: "new" | "hits" | "sets"; items: StoreProduct[] }
  | { key: "reviews"; reviews: RecentReview[] };

/** Блоки главной в порядке продавца; пустой блок (нет хитов, наборов, отзывов) не показывается. */
export async function showcase(ctx: TenantContext): Promise<ShowcaseSection[]> {
  const { blocks } = parseDesign(ctx.tenant.settings.storefront_design);
  const build = async (key: StoreBlock): Promise<ShowcaseSection | null> => {
    if (key === "reviews") {
      const reviews = await recentApprovedReviews(ctx, BLOCK_SIZE);
      return reviews.length ? { key, reviews } : null;
    }
    const page = await storeCatalogPage(ctx, {
      limit: BLOCK_SIZE,
      ...(key === "new" ? { sort: "new" as const } : {}),
      ...(key === "hits" ? { sort: "popular" as const } : {}),
      ...(key === "sets" ? { bundles: true } : {}),
    });
    // «Хиты» — только товары, у которых уже есть оценки: без них это просто начало каталога.
    const items = key === "hits" ? page.items.filter((p) => p.rating !== null) : page.items;
    return items.length ? { key, items } : null;
  };
  const out = await Promise.all(blocks.map(build));
  return out.filter((s): s is ShowcaseSection => s !== null);
}
