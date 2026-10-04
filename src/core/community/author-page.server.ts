import { serviceDb } from "@/core/db/client.server";
import { marketplaceCategory, marketplaceState } from "@/core/marketplace/consent";
import { isMissingTable } from "@/core/marketplace/not-ready";
import { storefrontOpen } from "@/core/storefront/access";
import { storeCatalogPage } from "@/core/storefront/catalog";
import { resolveTenant, tenantContext, tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { authorCard, communityProfile, shownInCommunity, type CommunityAuthor } from "./profile";
import { mutualRecommendations } from "./recommend";

/**
 * Публичная страница автора (С6): профиль из С1 и то, что магазин уже показывает всем сам:
 * «Что продаю» (первые товары витрины), рейтинг по одобренным отзывам (из каталога площадки) и
 * взаимные рекомендации. Нет согласия, автор скрыт или заблокирован, магазин на прежней платформе —
 * страницы нет (null), ничего не выдаётся.
 */
export const AUTHOR_ITEMS = 6;

export type AuthorPage = {
  slug: string;
  card: CommunityAuthor;
  category: string;
  /** Рейтинг по одобренным отзывам; есть, пока магазин на площадке. */
  rating: { value: number; count: number } | null;
  items: { id: string; name: string; price: number; priceFrom: boolean; currency: string }[];
  hasMoreItems: boolean;
  /** Есть витрина, куда можно перейти. */
  storefront: boolean;
  recommended: { name: string; slug: string }[];
};

async function marketRating(botId: string): Promise<AuthorPage["rating"]> {
  const { data, error } = await serviceDb()
    .from("marketplace_shops")
    .select("rating, rating_count")
    .eq("bot_id", botId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw serverFailure(`страница автора, рейтинг не прочитан: ${error.message}`);
  }
  const r = data as { rating: number | null; rating_count: number } | null;
  return r && r.rating != null && r.rating_count > 0
    ? { value: Number(r.rating), count: r.rating_count }
    : null;
}

export async function authorPage(slug: string): Promise<AuthorPage | null> {
  const t = await resolveTenant({ by: "slug", value: slug });
  if (!t || !t.settings.slug || !shownInCommunity(t)) return null;
  const card = authorCard(t);
  if (!card) return null;
  const open = storefrontOpen(t, "catalog");
  const [rating, page, all] = await Promise.all([
    marketplaceState(t) === "visible" ? marketRating(t.id) : Promise.resolve(null),
    open ? storeCatalogPage(tenantContext(t), { limit: AUTHOR_ITEMS }) : Promise.resolve(null),
    tenantDirectory(),
  ]);
  return {
    slug: t.settings.slug,
    card,
    category: marketplaceCategory(t),
    rating,
    items: (page?.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      priceFrom: p.priceFrom,
      currency: p.currency,
    })),
    hasMoreItems: page?.hasMore ?? false,
    storefront: open,
    recommended: recommendedFor(t, all),
  };
}

type Dir = Awaited<ReturnType<typeof tenantDirectory>>;

/** Взаимные рекомендации с адресом открытой витрины; без витрины — не показываем. */
function recommendedFor(t: Dir[number], all: Dir): { name: string; slug: string }[] {
  return mutualRecommendations(t, all)
    .filter((o) => o.settings.slug && storefrontOpen(o, "info"))
    .map((o) => ({ name: communityProfile(o.settings).name, slug: o.settings.slug! }));
}

/** Для витрины магазина `slug`: с кем у него взаимная рекомендация. Магазин вне сообщества — пусто. */
export async function recommendedShops(slug: string): Promise<{ name: string; slug: string }[]> {
  const t = await resolveTenant({ by: "slug", value: slug });
  if (!t || !storefrontOpen(t, "info")) return [];
  return recommendedFor(t, await tenantDirectory());
}
