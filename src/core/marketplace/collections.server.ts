import { serviceDb, type Db } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import type { Locale } from "@/core/i18n/locale";
import { serverFailure } from "@/lib/server-failure";
import {
  COLLECTIONS_MAX,
  COLLECTION_ITEMS_MAX,
  cleanItems,
  cleanTitles,
  collectionFromRow,
  titleFor,
  type Collection,
  type CollectionItem,
  type CollectionTitles,
} from "./collections";
import { confirmed } from "./feeds.server";
import type { MarketItem } from "./items";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";

type Shop = { slug: string; name: string };
type DbErr = { code?: string | undefined; message: string } | null;

function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, подборки, ${what}: ${error.message}`);
}

async function readAll(svc: Db, onlyPublished: boolean): Promise<Collection[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await pageAll<Record<string, unknown>>((from, to) => {
      let q = svc.from("market_collections").select("id, title, items, position, published, rev");
      if (onlyPublished) q = q.eq("published", true);
      return q.order("position").order("id").range(from, to);
    }, "площадка, подборки не прочитаны");
  } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) }))
      throw new MarketplaceNotReady();
    throw e;
  }
  return rows.flatMap((r) => {
    const c = collectionFromRow(r);
    return c ? [c] : [];
  });
}

/**
 * Подборки для главной площадки: только опубликованные, на языке покупателя; в состав входят
 * товары, которые покупатель может купить сейчас (строка снимка и показываемый магазин).
 * Удалённый, скрытый или закончившийся товар из подборки пропадает сам; пустая подборка не
 * показывается.
 */
export async function publicCollections(
  shops: Map<string, Shop>,
  locale: Locale,
  svc: Db = serviceDb(),
): Promise<Array<{ id: string; title: string; items: MarketItem[] }>> {
  const all = await readAll(svc, true);
  const out: Array<{ id: string; title: string; items: MarketItem[] }> = [];
  for (const c of all) {
    const cands = c.items.map((i) => ({ shopId: i.shopId, productId: i.productId }));
    const items = await confirmed(svc, shops, cands, COLLECTION_ITEMS_MAX, COLLECTION_ITEMS_MAX);
    if (items.length > 0) out.push({ id: c.id, title: titleFor(c.title, locale), items });
  }
  return out;
}

/** Оператору: все подборки (и черновики) с составом как записан. */
export async function operatorCollections(svc: Db = serviceDb()): Promise<Collection[]> {
  return readAll(svc, false);
}

export type CollectionInput = {
  id?: string;
  title: unknown;
  items: unknown;
  published: boolean;
  position: number;
  /** Правка, на которой оператор открыл подборку; у новой не нужна. */
  rev?: number;
};

/**
 * Создать или изменить подборку. Правка — условное обновление по `rev`: если подборку успели
 * изменить в другой вкладке, ничего не пишется, оператор получает понятное сообщение.
 */
export async function saveCollection(
  input: CollectionInput,
  svc: Db = serviceDb(),
  now: Date = new Date(),
): Promise<{ id: string; rev: number }> {
  const title: CollectionTitles | null = cleanTitles(input.title);
  if (!title) throw new Error("Нужно название подборки по-русски.");
  const items: CollectionItem[] | null = cleanItems(input.items);
  if (!items) throw new Error(`В подборке не больше ${COLLECTION_ITEMS_MAX} товаров.`);
  const body = {
    title,
    items: items.map((i) => ({ shop_id: i.shopId, product_id: i.productId })),
    published: input.published,
    position: Math.max(0, Math.min(10_000, Math.floor(input.position))),
    updated_at: now.toISOString(),
  };
  if (!input.id) {
    const total = await svc.from("market_collections").select("id", { count: "exact", head: true });
    check("число подборок не прочитано", total.error);
    if ((total.count ?? 0) >= COLLECTIONS_MAX)
      throw new Error(`Подборок не больше ${COLLECTIONS_MAX}.`);
    const { data, error } = await svc
      .from("market_collections")
      .insert({ ...body, rev: 1 })
      .select("id, rev")
      .single();
    check("подборка не создана", error);
    return { id: String(data!.id), rev: 1 };
  }
  if (!Number.isInteger(input.rev)) throw new Error("Обновите страницу: подборка изменилась.");
  const next = (input.rev as number) + 1;
  const { data, error } = await svc
    .from("market_collections")
    .update({ ...body, rev: next })
    .eq("id", input.id)
    .eq("rev", input.rev as number)
    .select("id");
  check("подборка не сохранена", error);
  if (!data || data.length === 0)
    throw new Error("Подборку изменили в другом окне или удалили. Обновите страницу.");
  return { id: input.id, rev: next };
}

export async function deleteCollection(id: string, svc: Db = serviceDb()): Promise<void> {
  const { error } = await svc.from("market_collections").delete().eq("id", id);
  check("подборка не удалена", error);
}

export type OperatorCollection = Collection & {
  /** Названия товаров состава по снимку; null — товара на площадке сейчас нет (скрыт, закончился, удалён). */
  names: Array<string | null>;
};

/** Оператору: подборки с названиями товаров, чтобы состав можно было прочитать. */
export async function operatorCollectionsView(
  svc: Db = serviceDb(),
): Promise<OperatorCollection[]> {
  const all = await readAll(svc, false);
  const ids = [...new Set(all.flatMap((c) => c.items.map((i) => i.productId)))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await svc
      .from("marketplace_items")
      .select("bot_id, product_id, name")
      .in("product_id", ids.slice(i, i + 200));
    check("названия товаров не прочитаны", error);
    for (const r of data ?? []) names.set(`${r.bot_id}:${r.product_id}`, String(r.name));
  }
  return all.map((c) => ({
    ...c,
    names: c.items.map((i) => names.get(`${i.shopId}:${i.productId}`) ?? null),
  }));
}
