import { serviceDb, type Db } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";
import { FEED_PER_SHOP, FEED_SIZE, POPULAR_KEY, capPerShop, parsePopular } from "./popular";
import type { MarketItem } from "./items";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";

/**
 * Ленты площадки (Л2): «Новинки» и «Часто покупают». Показываем только то, что покупатель может
 * купить сейчас: строка снимка `marketplace_items` и магазин, которому вправе показываться
 * (скрытые, выключившие и клиенты прежней платформы в `shops` не попадают). «Недавно смотрели»
 * живёт только в браузере и сюда не заходит.
 */
type Shop = { slug: string; name: string };
type Cand = { shopId: string; productId: string };
type DbErr = { code?: string | undefined; message: string } | null;

const CHUNK = 200;
/** Сколько кандидатов проверяем по снимку: с запасом на скрытое и закончившееся. */
const CANDIDATES = 100;
const FRESH_PER_CHUNK = 60;
const COLS = "bot_id, product_id, name, price, currency, image, updated_at";

function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, ${what}: ${error.message}`);
}

/** Кандидаты → товары из снимка в том же порядке; без строки снимка (скрыт, закончился) — выпадают. */
export async function confirmed(
  svc: Db,
  shops: Map<string, Shop>,
  cands: Cand[],
  perShop: number = FEED_PER_SHOP,
  size: number = FEED_SIZE,
  window: number = CANDIDATES,
): Promise<MarketItem[]> {
  const top = cands.slice(0, window);
  const rows = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < top.length; i += CHUNK) {
    const { data, error } = await svc
      .from("marketplace_items")
      .select(COLS)
      .in(
        "product_id",
        top.slice(i, i + CHUNK).map((c) => c.productId),
      );
    check("ленты, снимок не прочитан", error);
    for (const r of data ?? []) rows.set(`${r.bot_id}:${r.product_id}`, r);
  }
  const out: MarketItem[] = [];
  for (const c of top) {
    const r = rows.get(`${c.shopId}:${c.productId}`);
    const shop = shops.get(c.shopId);
    if (!r || !shop) continue;
    out.push({
      id: c.productId,
      shopId: c.shopId,
      shopSlug: shop.slug,
      shopName: shop.name,
      name: String(r.name),
      price: Number(r.price),
      currency: String(r.currency),
      image: (r.image as string | null) ?? null,
      at: String(r.updated_at),
    });
  }
  return capPerShop(out, perShop, size);
}

/** «Новинки»: самые новые товары показываемых магазинов (по дате создания товара). */
export async function freshItems(
  shops: Map<string, Shop>,
  svc: Db = serviceDb(),
): Promise<MarketItem[]> {
  const ids = [...shops.keys()];
  const found: Array<Cand & { at: string }> = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await svc
      .from("products")
      .select("id, bot_id, created_at")
      .eq("is_active", true)
      .in("bot_id", ids.slice(i, i + CHUNK))
      .order("created_at", { ascending: false })
      .order("id")
      .range(0, FRESH_PER_CHUNK - 1);
    check("новинки не прочитаны", error);
    for (const p of data ?? [])
      found.push({ shopId: String(p.bot_id), productId: String(p.id), at: String(p.created_at) });
  }
  found.sort((a, b) =>
    a.at === b.at ? (a.productId < b.productId ? -1 : 1) : a.at < b.at ? 1 : -1,
  );
  return confirmed(svc, shops, found);
}

/** «Часто покупают»: по цифрам, которые крон площадки кладёт в настройки магазинов. */
export async function popularItems(
  shops: Map<string, Shop>,
  svc: Db = serviceDb(),
): Promise<MarketItem[]> {
  const ids = [...shops.keys()];
  const found: Array<Cand & { n: number }> = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await svc
      .from("app_settings")
      .select("bot_id, value")
      .eq("key", POPULAR_KEY)
      .in("bot_id", ids.slice(i, i + CHUNK));
    check("«часто покупают» не прочитано", error);
    for (const row of data ?? [])
      for (const it of parsePopular(String(row.value))?.items ?? [])
        found.push({ shopId: String(row.bot_id), productId: it.id, n: it.n });
  }
  found.sort(
    (a, b) =>
      b.n - a.n ||
      (a.shopId < b.shopId ? -1 : a.shopId > b.shopId ? 1 : a.productId < b.productId ? -1 : 1),
  );
  return confirmed(svc, shops, found);
}

/**
 * «Недавно смотрели»: адреса и товары приходят из браузера покупателя (сервер ничего не хранит
 * и не пишет); отвечаем только тем, что есть в снимке показываемых магазинов, в порядке просмотра.
 */
export async function recentItems(
  shops: Map<string, Shop>,
  views: ReadonlyArray<{ slug: string; id: string }>,
  svc: Db = serviceDb(),
): Promise<MarketItem[]> {
  const botOf = new Map([...shops].map(([id, s]) => [s.slug, id]));
  const cands = views.flatMap((v) => {
    const shopId = botOf.get(v.slug);
    return shopId ? [{ shopId, productId: v.id }] : [];
  });
  return confirmed(svc, shops, cands, FEED_SIZE);
}

/** Обе ленты для страницы «Все товары» без запроса. */
export async function marketFeeds(
  shops?: Map<string, Shop>,
  svc: Db = serviceDb(),
): Promise<{ fresh: MarketItem[]; popular: MarketItem[] }> {
  const list = shops ?? (await (await import("./items.server")).directoryShops());
  const [fresh, popular] = await Promise.all([freshItems(list, svc), popularItems(list, svc)]);
  return { fresh, popular };
}
