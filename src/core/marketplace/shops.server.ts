import { serviceDb, type Db } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { marketplaceCategory, marketplaceCity, shownOnMarketplace } from "./consent";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";
import { MARKET_PAGE, cleanLabel, shopRating, tally, type MarketShop } from "./shops";

/**
 * Каталог магазинов площадки (В7). Данные общие для всех покупателей, поэтому
 * таблица `marketplace_shops` читается и пишется под serviceDb (RLS без прав
 * для анонимов, см. migrations/19-7); оценки товаров магазин читает под своей
 * ролью. Таблицы может не быть — тогда MarketplaceNotReady, раздел пишет «скоро».
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, ${what}: ${error.message}`);
}

export type RefreshResult = {
  action: "listed" | "removed" | "not-ready";
};

/**
 * Один проход крона по одному магазину: согласный и одобренный попадает в каталог
 * (или обновляется), остальной — убирается. Крон обходит только клиентов v2,
 * а страница ещё раз сверяет участие по справочнику арендаторов.
 */
export async function refreshMarketplaceShop(
  ctx: TenantContext,
  svc: Db = serviceDb(),
): Promise<RefreshResult> {
  const t = ctx.tenant;
  try {
    const slug = t.settings.slug;
    if (!shownOnMarketplace(t) || !slug) {
      const { error } = await svc.from("marketplace_shops").delete().eq("bot_id", t.id);
      check("магазин не убран из каталога", error);
      return { action: "removed" };
    }
    // Оценка — только по одобренным отзывам, как её видит покупатель на витрине:
    // колонки products.rating_* считают и скрытые отзывы. Читаем только товары с оценками.
    const rated = await pageAll<{ id: string }>(
      (from, to) =>
        ctx.db
          .from("products")
          .select("id")
          .eq("bot_id", t.id)
          .eq("is_active", true)
          .gt("rating_count", 0)
          .order("id")
          .range(from, to),
      "площадка, товары с оценками не прочитаны",
    );
    const { approvedRatings } = await import("@/core/reviews/photos.server");
    const approved = await approvedRatings(
      ctx,
      rated.map((p) => p.id),
    );
    const { rating, count } = shopRating(
      [...approved.values()].map((r) => ({ rating_avg: r.avg, rating_count: r.count })),
    );
    const { error } = await svc.from("marketplace_shops").upsert(
      {
        bot_id: t.id,
        slug,
        name: t.name,
        category: marketplaceCategory(t),
        city: marketplaceCity(t),
        rating,
        rating_count: count,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bot_id" },
    );
    check("магазин не записан в каталог", error);
    return { action: "listed" };
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return { action: "not-ready" };
    throw e;
  }
}

/** Магазины, которые вправе показываться сейчас: согласие, одобрение, не скрыт, v2. */
export const shownShopIds = (tenants: Tenant[]): Set<string> =>
  new Set(tenants.filter(shownOnMarketplace).map((t) => t.id));

async function directoryShown(): Promise<Set<string>> {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return shownShopIds(await tenantDirectory());
}

type ShopRow = {
  bot_id: string;
  slug: string;
  name: string;
  category: string;
  city: string;
  rating: number | null;
  rating_count: number;
};
const SHOP_COLS = "bot_id, slug, name, category, city, rating, rating_count";
const SCAN_BATCH = 50;
const SCAN_BATCHES = 10;

export type MarketQuery = { category?: string; city?: string; search?: string; offset?: number };
type Deps = { svc?: Db; shown?: () => Promise<Set<string>> };

/**
 * Страница каталога: не больше MARKET_PAGE магазинов; `next` — смещение для «Показать ещё»
 * (по просмотренным строкам, ничего не теряется), null — конец. Строки магазинов, которые
 * сейчас не вправе показываться (выключили, скрыты, ушли с v2), пропускаются.
 */
export async function listMarketShops(
  q: MarketQuery,
  deps: Deps = {},
): Promise<{ shops: MarketShop[]; next: number | null }> {
  const svc = deps.svc ?? serviceDb();
  const shown = await (deps.shown ?? directoryShown)();
  const category = cleanLabel(q.category);
  const city = cleanLabel(q.city);
  const search = cleanLabel(q.search);
  const out: MarketShop[] = [];
  let offset = Math.max(0, Math.floor(q.offset ?? 0));
  for (let i = 0; i < SCAN_BATCHES; i++) {
    let query = svc.from("marketplace_shops").select(SHOP_COLS);
    if (category) query = query.eq("category", category);
    if (city) query = query.eq("city", city);
    if (search) query = query.ilike("name", `%${search}%`);
    const { data, error } = await query
      .order("name", { ascending: true })
      .order("bot_id", { ascending: true })
      .range(offset, offset + SCAN_BATCH - 1);
    check("каталог не прочитан", error);
    const rows = (data ?? []) as ShopRow[];
    for (const r of rows) {
      offset++;
      if (!shown.has(r.bot_id)) continue;
      out.push({
        id: r.bot_id,
        slug: r.slug,
        name: r.name,
        category: r.category,
        city: r.city,
        rating: r.rating,
        ratingCount: r.rating_count,
      });
      if (out.length >= MARKET_PAGE) return { shops: out, next: offset };
    }
    if (rows.length < SCAN_BATCH) return { shops: out, next: null };
  }
  return { shops: out, next: offset };
}

/** Категории и города, которые есть у показываемых магазинов, — для фильтров. */
export async function marketFacets(deps: Deps = {}): Promise<{
  categories: Array<{ value: string; count: number }>;
  cities: Array<{ value: string; count: number }>;
}> {
  const svc = deps.svc ?? serviceDb();
  const shown = await (deps.shown ?? directoryShown)();
  const rows = await pageAll<{ bot_id: string; category: string; city: string }>(
    (from, to) =>
      svc
        .from("marketplace_shops")
        .select("bot_id, category, city")
        .order("bot_id")
        .range(from, to),
    "площадка, фильтры не прочитаны",
  ).catch((e: unknown) => {
    // pageAll поднимает serverFailure с текстом базы: «таблицы нет» отличаем по нему.
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) }))
      throw new MarketplaceNotReady();
    throw e;
  });
  const mine = rows.filter((r) => shown.has(r.bot_id));
  return { categories: tally(mine.map((r) => r.category)), cities: tally(mine.map((r) => r.city)) };
}
