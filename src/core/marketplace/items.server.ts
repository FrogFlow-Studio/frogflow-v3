import { serviceDb, type Db } from "@/core/db/client.server";
import { eachPage } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { storeCatalogPage } from "@/core/storefront/catalog";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { shownOnMarketplace } from "./consent";
import {
  ITEMS_PER_SHOP_MAX,
  MARKET_ITEMS_PAGE,
  itemRow,
  searchWords,
  type MarketItem,
} from "./items";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";

/**
 * Снимок товаров площадки и поиск по нему (В8). Таблица `marketplace_items` общая для всех
 * покупателей площадки, поэтому пишется и читается под serviceDb (RLS без прав для анонимов,
 * см. migrations/19-8). Таблицы может не быть — тогда MarketplaceNotReady, поиск пишет «скоро».
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, ${what}: ${error.message}`);
}

const CHUNK = 200;
const READ_PAGE = 100;

export type ItemsResult =
  | { action: "synced"; items: number; removed: number; truncated: boolean }
  | { action: "removed" }
  | { action: "not-ready" };

/** Товары магазина, которые покупатель видит и может купить на витрине сейчас. */
async function sellableNow(
  ctx: TenantContext,
): Promise<{ items: Awaited<ReturnType<typeof storeCatalogPage>>["items"]; truncated: boolean }> {
  const items: Awaited<ReturnType<typeof storeCatalogPage>>["items"] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const page = await storeCatalogPage(ctx, { inStock: true, offset, limit: READ_PAGE });
    items.push(...page.items);
    if (!page.hasMore) return { items, truncated: false };
    if (items.length >= ITEMS_PER_SHOP_MAX) return { items, truncated: true };
  }
}

/**
 * Проход крона по товарам одного магазина, показываемого на площадке: снимок обновляется,
 * скрытое и закончившееся уходит. Сначала читается витрина (сбой чтения — ошибка, таблица
 * не тронута: «не удалось прочитать» не превращается в «убрать всё»), потом пишется.
 */
export async function syncMarketplaceItems(
  ctx: TenantContext,
  svc: Db = serviceDb(),
  at: Date = new Date(),
): Promise<ItemsResult> {
  const botId = ctx.tenant.id;
  try {
    const { items, truncated } = await sellableNow(ctx);
    const stamp = at.toISOString();
    const rows = items.map((p) => itemRow(botId, p, stamp));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await svc
        .from("marketplace_items")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "bot_id,product_id" });
      check("товары не записаны", error);
    }
    const keep = new Set(rows.map((r) => r.product_id));
    const stale: string[] = [];
    await eachPage<{ product_id: string }>(
      (from, to) =>
        svc
          .from("marketplace_items")
          .select("product_id")
          .eq("bot_id", botId)
          .order("product_id")
          .range(from, to),
      "площадка, снимок товаров не прочитан",
      (page) => {
        for (const r of page) if (!keep.has(r.product_id)) stale.push(r.product_id);
      },
    );
    for (let i = 0; i < stale.length; i += CHUNK) {
      const chunk = stale.slice(i, i + CHUNK);
      const { error } = await svc
        .from("marketplace_items")
        .delete()
        .eq("bot_id", botId)
        .in("product_id", chunk);
      check("устаревшие товары не убраны", error);
    }
    return { action: "synced", items: rows.length, removed: stale.length, truncated };
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return { action: "not-ready" };
    // eachPage поднимает serverFailure с текстом базы: «таблицы нет» отличаем по нему.
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) }))
      return { action: "not-ready" };
    throw e;
  }
}

/** Магазин не показывается на площадке: его товаров в снимке быть не должно. */
export async function removeMarketplaceItems(
  botId: string,
  svc: Db = serviceDb(),
): Promise<ItemsResult> {
  const { error } = await svc.from("marketplace_items").delete().eq("bot_id", botId);
  if (error && isMissingTable(error)) return { action: "not-ready" };
  if (error) throw serverFailure(`площадка, товары магазина не убраны: ${error.message}`);
  return { action: "removed" };
}

type ShopCard = { slug: string; name: string };

/** Магазины, показываемые сейчас: id → адрес и название (из справочника арендаторов). */
export function shownShops(tenants: Tenant[]): Map<string, ShopCard> {
  const out = new Map<string, ShopCard>();
  for (const t of tenants)
    if (shownOnMarketplace(t) && t.settings.slug)
      out.set(t.id, { slug: t.settings.slug, name: t.name });
  return out;
}

async function directoryShops(): Promise<Map<string, ShopCard>> {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return shownShops(await tenantDirectory());
}

type ItemRow = {
  bot_id: string;
  product_id: string;
  name: string;
  price: number;
  currency: string;
  image: string | null;
  updated_at: string;
};
const ITEM_COLS = "bot_id, product_id, name, price, currency, image, updated_at";
const SCAN_BATCH = 50;
const SCAN_BATCHES = 10;

/**
 * Поиск товаров по всей площадке: каждое слово запроса должно встретиться в названии или
 * начале описания. Строки магазинов, которые сейчас не вправе показываться, пропускаются.
 * Страница — не больше MARKET_ITEMS_PAGE; `next` — смещение для «Показать ещё», null — конец.
 */
export async function searchMarketItems(
  q: { search?: string; offset?: number },
  deps: { svc?: Db; shown?: () => Promise<Map<string, ShopCard>> } = {},
): Promise<{ items: MarketItem[]; next: number | null; words: string[] }> {
  const words = searchWords(q.search);
  if (words.length === 0) return { items: [], next: null, words };
  const svc = deps.svc ?? serviceDb();
  const shops = await (deps.shown ?? directoryShops)();
  const out: MarketItem[] = [];
  let offset = Math.max(0, Math.floor(q.offset ?? 0));
  for (let i = 0; i < SCAN_BATCHES; i++) {
    let query = svc.from("marketplace_items").select(ITEM_COLS);
    for (const w of words) query = query.ilike("search_text", `%${w}%`);
    const { data, error } = await query
      .order("name", { ascending: true })
      .order("bot_id", { ascending: true })
      .order("product_id", { ascending: true })
      .range(offset, offset + SCAN_BATCH - 1);
    check("поиск не выполнен", error);
    const rows = (data ?? []) as ItemRow[];
    for (const r of rows) {
      offset++;
      const shop = shops.get(r.bot_id);
      if (!shop) continue;
      out.push({
        id: r.product_id,
        shopId: r.bot_id,
        shopSlug: shop.slug,
        shopName: shop.name,
        name: r.name,
        price: Number(r.price),
        currency: r.currency,
        image: r.image,
        at: r.updated_at,
      });
      if (out.length >= MARKET_ITEMS_PAGE) return { items: out, next: offset, words };
    }
    if (rows.length < SCAN_BATCH) return { items: out, next: null, words };
  }
  return { items: out, next: offset, words };
}
