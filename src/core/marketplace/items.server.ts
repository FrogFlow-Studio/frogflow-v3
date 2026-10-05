import { serviceDb, type Db } from "@/core/db/client.server";
import { getSettingStrict, trySetSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { cleanLabel, tally } from "./shops";
import { storeCatalogPage } from "@/core/storefront/catalog";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { marketplaceCategory, shownOnMarketplace } from "./consent";
import {
  ITEMS_PER_SHOP_MAX,
  MARKET_ITEMS_PAGE,
  FUZZY_MIN_LENGTH,
  itemRow,
  matchesAll,
  nearWord,
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
  /** Бюджет крона кончился посреди магазина: записанное остаётся, следующий запуск идёт дальше. */
  | { action: "partial"; items: number }
  | { action: "removed" }
  | { action: "not-ready" };

/** Где остановился проход по большому магазину: метка прохода и смещение в витрине. */
export const ITEMS_CURSOR_KEY = "marketplace_items_cursor";
/** Курсор старше — проход начинается заново: витрина за это время успела сильно сдвинуться. */
const CURSOR_TTL_MS = 6 * 3_600_000;

type Cursor = { stamp: string; offset: number; written: number };

function parseCursor(raw: string | null, at: Date): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Cursor>;
    const t = typeof c.stamp === "string" ? Date.parse(c.stamp) : NaN;
    if (!Number.isFinite(t) || at.getTime() - t > CURSOR_TTL_MS || t > at.getTime()) return null;
    if (!Number.isInteger(c.offset) || (c.offset as number) < 0) return null;
    if (!Number.isInteger(c.written) || (c.written as number) < 0) return null;
    return { stamp: c.stamp as string, offset: c.offset as number, written: c.written as number };
  } catch {
    return null;
  }
}

/**
 * Проход крона по товарам одного магазина, показываемого на площадке: снимок обновляется,
 * скрытое и закончившееся уходит. Витрина читается страницами, каждая сразу пишется (upsert по
 * `bot_id,product_id`: повтор не дублирует строки). Когда `spent()` говорит, что бюджет крона
 * кончился, проход останавливается между страницами и пишет курсор в `app_settings`; следующий
 * запуск продолжает с того места с той же меткой. Устаревшее убирается только после полного
 * прохода: строки со старой меткой `updated_at`. Сбой чтения — ошибка, ничего не удалено
 * («не удалось прочитать» не превращается в «убрать всё»).
 */
export async function syncMarketplaceItems(
  ctx: TenantContext,
  svc: Db = serviceDb(),
  at: Date = new Date(),
  opts: { spent?: () => boolean } = {},
): Promise<ItemsResult> {
  const botId = ctx.tenant.id;
  try {
    const cursor = parseCursor(await getSettingStrict(ctx, ITEMS_CURSOR_KEY), at);
    const stamp = cursor?.stamp ?? at.toISOString();
    let offset = cursor?.offset ?? 0;
    let written = cursor?.written ?? 0;
    let truncated = false;
    for (;;) {
      const page = await storeCatalogPage(ctx, { inStock: true, offset, limit: READ_PAGE });
      const rows = page.items.map((p) => itemRow(botId, p, stamp));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await svc
          .from("marketplace_items")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "bot_id,product_id" });
        check("товары не записаны", error);
      }
      written += rows.length;
      offset += READ_PAGE;
      if (!page.hasMore) break;
      if (written >= ITEMS_PER_SHOP_MAX) {
        truncated = true;
        break;
      }
      if (opts.spent?.()) {
        await trySetSetting(ctx, ITEMS_CURSOR_KEY, JSON.stringify({ stamp, offset, written }));
        return { action: "partial", items: written };
      }
    }
    const { data, error } = await svc
      .from("marketplace_items")
      .delete()
      .eq("bot_id", botId)
      .lt("updated_at", stamp)
      .select("product_id");
    check("устаревшие товары не убраны", error);
    if (cursor) await trySetSetting(ctx, ITEMS_CURSOR_KEY, "");
    return { action: "synced", items: written, removed: (data ?? []).length, truncated };
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return { action: "not-ready" };
    // Витрина и курсор поднимают serverFailure с текстом базы: «таблицы нет» отличаем по нему.
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

type ShopCard = { slug: string; name: string; category?: string };

/** Магазины, показываемые сейчас: id → адрес и название (из справочника арендаторов). */
export function shownShops(tenants: Tenant[]): Map<string, ShopCard> {
  const out = new Map<string, ShopCard>();
  for (const t of tenants)
    if (shownOnMarketplace(t) && t.settings.slug)
      out.set(t.id, { slug: t.settings.slug, name: t.name, category: marketplaceCategory(t) });
  return out;
}

export async function directoryShops(): Promise<Map<string, ShopCard>> {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return shownShops(await tenantDirectory());
}

type ItemRow = {
  bot_id: string;
  product_id: string;
  name: string;
  search_text: string | null;
  price: number;
  currency: string;
  image: string | null;
  updated_at: string;
};
const ITEM_COLS = "bot_id, product_id, name, search_text, price, currency, image, updated_at";
const SCAN_BATCH = 50;
const SCAN_BATCHES = 10;
const SHOP_IN_MAX = 200;
const STEM = 3;

const shopTextOf = (s: ShopCard) => `${s.name} ${s.category ?? ""}`.toLowerCase();

/**
 * Поиск товаров по всей площадке (Л1): каждое слово запроса должно встретиться в названии,
 * начале описания, названии магазина (автора) или его категории. Если точных совпадений нет,
 * ищем с опечатками (`fuzzy`: допуск 1–2 знака у слов от пяти букв) и сообщаем об этом.
 * Строки магазинов, которые сейчас не вправе показываться, пропускаются. Страница — не больше
 * MARKET_ITEMS_PAGE; `next` — смещение для «Показать ещё», null — конец; в режиме с опечатками
 * его передают вместе с `fuzzy: true`.
 */
export async function searchMarketItems(
  q: { search?: string; category?: string; offset?: number; fuzzy?: boolean },
  deps: { svc?: Db; shown?: () => Promise<Map<string, ShopCard>> } = {},
): Promise<{ items: MarketItem[]; next: number | null; words: string[]; fuzzy: boolean }> {
  const words = searchWords(q.search);
  const category = cleanLabel(q.category);
  // Без слов и без категории искать нечего; с одной категорией показываем её товары (П1).
  if (words.length === 0 && !category) return { items: [], next: null, words, fuzzy: false };
  const svc = deps.svc ?? serviceDb();
  const shops = await (deps.shown ?? directoryShops)();
  const start = Math.max(0, Math.floor(q.offset ?? 0));
  const exact = q.fuzzy ? null : await scan(svc, shops, words, category, start, false);
  if (exact && (exact.items.length > 0 || start > 0 || words.length === 0))
    return { ...exact, words, fuzzy: false };
  const near = await scan(svc, shops, words, category, start, true);
  return { ...near, words, fuzzy: near.items.length > 0 };
}

async function scan(
  svc: Db,
  shops: Map<string, ShopCard>,
  words: string[],
  category: string,
  start: number,
  fuzzy: boolean,
): Promise<{ items: MarketItem[]; next: number | null }> {
  const shopTexts = [...shops.values()].map(shopTextOf);
  // Слово, которое где-то совпало с магазином, в базе не фильтруем: решает проверка в коде.
  const inShop = (w: string) => shopTexts.some((t) => t.includes(w) || (fuzzy && nearWord(w, t)));
  const filters = words
    .filter((w) => !inShop(w))
    .map((w) => (fuzzy && w.length >= FUZZY_MIN_LENGTH ? w.slice(0, STEM) : w));
  const out: MarketItem[] = [];
  let offset = start;
  for (let i = 0; i < SCAN_BATCHES; i++) {
    let query = svc.from("marketplace_items").select(ITEM_COLS);
    for (const w of filters) query = query.ilike("search_text", `%${w}%`);
    if (shops.size > 0 && shops.size <= SHOP_IN_MAX)
      query = query.in("bot_id", [...shops.keys()].slice(0, SHOP_IN_MAX));
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
      if (category && shop.category !== category) continue;
      if (!matchesAll(words, r.search_text ?? r.name, shopTextOf(shop), fuzzy)) continue;
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
      if (out.length >= MARKET_ITEMS_PAGE) return { items: out, next: offset };
    }
    if (rows.length < SCAN_BATCH) return { items: out, next: null };
  }
  return { items: out, next: offset };
}

/** Категории показываемых магазинов для фильтра на странице «Все товары» (П1). */
export async function itemFacets(
  deps: { shown?: () => Promise<Map<string, ShopCard>> } = {},
): Promise<Array<{ value: string; count: number }>> {
  const shops = await (deps.shown ?? directoryShops)();
  return tally([...shops.values()].map((s) => s.category ?? ""));
}
