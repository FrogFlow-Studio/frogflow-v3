import { serviceDb, type Db } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { shownShops } from "./items.server";
import { FAVORITES_MAX, favoriteKey, isUuid, type FavoriteItem } from "./favorites";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";
import type { Tenant } from "@/core/tenant/types";

/**
 * Избранное на площадке (К1). Таблица `buyer_favorites` общая для магазинов, поэтому всё идёт
 * под serviceDb, а «кто этот человек» решает вызывающий (подписанная cookie площадки, выдаётся
 * только подтверждённым входом): сюда приходит уже `buyerId`, и каждый запрос режется по нему.
 * Почта без подтверждения человека не создаёт, значит избранного не открывает.
 * Таблицы нет (миграция 22-1 не применена) — MarketplaceNotReady, «скоро».
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, избранное, ${what}: ${error.message}`);
}
const duplicate = (e: DbErr) => e?.code === "23505";
const CHUNK = 200;

export type FavoriteResult =
  | { status: "added" | "already" | "removed" }
  | { status: "unknown" } // товара нет в снимке площадки или магазин не показывается
  | { status: "full" }; // уже FAVORITES_MAX

type Deps = { svc?: Db; tenants: readonly Tenant[] };

/** Отметить товар: он должен быть в снимке площадки у магазина, который сейчас показывается. */
export async function addFavorite(
  buyerId: string,
  botId: string,
  productId: string,
  deps: Deps,
): Promise<FavoriteResult> {
  if (!isUuid(buyerId) || !isUuid(botId) || !isUuid(productId)) return { status: "unknown" };
  const svc = deps.svc ?? serviceDb();
  if (!shownShops([...deps.tenants]).has(botId)) return { status: "unknown" };
  const { data: item, error: ie } = await svc
    .from("marketplace_items")
    .select("product_id")
    .eq("bot_id", botId)
    .eq("product_id", productId)
    .maybeSingle();
  if (ie && isMissingTable(ie)) throw new MarketplaceNotReady();
  if (ie) throw serverFailure(`площадка, избранное, товар не прочитан: ${ie.message}`);
  if (!item) return { status: "unknown" };
  const { count, error: ce } = await svc
    .from("buyer_favorites")
    .select("product_id", { count: "exact", head: true })
    .eq("buyer_id", buyerId);
  check("число не прочитано", ce);
  if ((count ?? 0) >= FAVORITES_MAX) {
    // уже отмеченный не считается новым: повтор после предела остаётся «уже»
    const { data: held, error: he } = await svc
      .from("buyer_favorites")
      .select("product_id")
      .eq("buyer_id", buyerId)
      .eq("bot_id", botId)
      .eq("product_id", productId)
      .maybeSingle();
    check("отметка не прочитана", he);
    return held ? { status: "already" } : { status: "full" };
  }
  const { error } = await svc
    .from("buyer_favorites")
    .insert({ buyer_id: buyerId, bot_id: botId, product_id: productId });
  if (duplicate(error)) return { status: "already" };
  check("не записано", error);
  return { status: "added" };
}

/** Убрать отметку: только свою (условие по человеку), чужая строка не затрагивается. */
export async function removeFavorite(
  buyerId: string,
  botId: string,
  productId: string,
  svc: Db = serviceDb(),
): Promise<FavoriteResult> {
  if (!isUuid(buyerId) || !isUuid(botId) || !isUuid(productId)) return { status: "unknown" };
  const { error } = await svc
    .from("buyer_favorites")
    .delete()
    .eq("buyer_id", buyerId)
    .eq("bot_id", botId)
    .eq("product_id", productId);
  check("не убрано", error);
  return { status: "removed" };
}

type Marked = { bot_id: string; product_id: string };

/** Все отметки человека, новые первыми; порядок заканчивается уникальным ключом. */
async function marked(buyerId: string, svc: Db): Promise<Marked[]> {
  try {
    return await pageAll<Marked>(
      (from, to) =>
        svc
          .from("buyer_favorites")
          .select("bot_id, product_id, created_at")
          .eq("buyer_id", buyerId)
          .order("created_at", { ascending: false })
          .order("bot_id", { ascending: true })
          .order("product_id", { ascending: true })
          .range(from, to),
      "площадка, избранное не прочитано",
    );
  } catch (e) {
    if (e instanceof Error && isMissingTable({ message: e.message }))
      throw new MarketplaceNotReady();
    throw e;
  }
}

/** Ключи «магазин:товар» отмеченного: для сердечек в поиске. */
export async function favoriteKeys(buyerId: string, svc: Db = serviceDb()): Promise<string[]> {
  if (!isUuid(buyerId)) return [];
  return (await marked(buyerId, svc)).map((m) => favoriteKey(m.bot_id, m.product_id));
}

export type FavoritesList = { items: FavoriteItem[]; gone: number };

/**
 * Избранное для страницы «Мои заказы»: товары из снимка у показываемых сейчас магазинов.
 * Что из снимка ушло (закончился, магазин скрыт) в список не попадает, но считается в `gone`:
 * человек видит «ещё N недоступны», а не молчаливую потерю. Сбой чтения — ошибка, не «пусто».
 */
export async function listFavorites(buyerId: string, deps: Deps): Promise<FavoritesList> {
  if (!isUuid(buyerId)) return { items: [], gone: 0 };
  const svc = deps.svc ?? serviceDb();
  const rows = await marked(buyerId, svc);
  if (rows.length === 0) return { items: [], gone: 0 };
  const shops = shownShops([...deps.tenants]);
  const found = new Map<string, FavoriteItem>();
  const byShop = new Map<string, string[]>();
  for (const r of rows) {
    if (!shops.has(r.bot_id)) continue;
    byShop.set(r.bot_id, [...(byShop.get(r.bot_id) ?? []), r.product_id]);
  }
  for (const [botId, ids] of byShop) {
    const shop = shops.get(botId)!;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await svc
        .from("marketplace_items")
        .select("bot_id, product_id, name, price, currency, image")
        .eq("bot_id", botId)
        .in("product_id", ids.slice(i, i + CHUNK))
        .order("product_id", { ascending: true });
      if (error && isMissingTable(error)) throw new MarketplaceNotReady();
      if (error) throw serverFailure(`площадка, избранное, товары не прочитаны: ${error.message}`);
      for (const r of (data ?? []) as {
        bot_id: string;
        product_id: string;
        name: string;
        price: number;
        currency: string;
        image: string | null;
      }[])
        found.set(favoriteKey(r.bot_id, r.product_id), {
          shopId: botId,
          shopSlug: shop.slug,
          shopName: shop.name,
          id: r.product_id,
          name: r.name,
          price: Number(r.price),
          currency: r.currency,
          image: r.image,
        });
    }
  }
  // Порядок — как у отметок (новые первыми).
  const items: FavoriteItem[] = [];
  for (const r of rows) {
    const it = found.get(favoriteKey(r.bot_id, r.product_id));
    if (it) items.push(it);
  }
  return { items, gone: rows.length - items.length };
}
