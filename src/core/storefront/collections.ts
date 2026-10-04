import { UserError } from "@/core/i18n/user-error";

/**
 * Подборки витрины («Подарки до 10 000 ₸», «Новинки октября»): продавец собирает
 * список товаров, получает страницу и ссылку для бота и соцсетей. Хранятся в
 * `bots.settings.collections`, без новой таблицы. В подборке только id товаров:
 * имена, цены и остатки читаются из каталога при каждом открытии, поэтому
 * удалённый, скрытый или закончившийся товар просто не показывается.
 */
export const COLLECTIONS_MAX = 24;
export const COLLECTION_NAME_MAX = 80;
export const COLLECTION_PRODUCTS_MAX = 60;

export type Collection = {
  /** Короткий код в ссылке: 8 символов a–z, 0–9. */
  id: string;
  name: string;
  product_ids: string[];
  created_at: string;
};

const ID_RE = /^[a-z0-9]{6,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сырой jsonb → подборки; чужое, битое и повторы отбрасываются, лимиты соблюдаются. */
export function parseCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  const out: Collection[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const c = v as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    const name = typeof c.name === "string" ? c.name.trim().slice(0, COLLECTION_NAME_MAX) : "";
    if (!ID_RE.test(id) || seen.has(id) || !name) continue;
    seen.add(id);
    const ids: string[] = [];
    if (Array.isArray(c.product_ids))
      for (const p of c.product_ids)
        if (typeof p === "string" && UUID_RE.test(p) && !ids.includes(p)) ids.push(p);
    out.push({
      id,
      name,
      product_ids: ids.slice(0, COLLECTION_PRODUCTS_MAX),
      created_at: typeof c.created_at === "string" ? c.created_at : "",
    });
    if (out.length >= COLLECTIONS_MAX) break;
  }
  return out;
}

export function newCollectionId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export type CollectionInput = { id?: string; name: string; productIds: readonly string[] };

/** Новая или изменённая подборка; порядок товаров — как выбрал продавец. */
export function upsertCollection(
  list: readonly Collection[],
  input: CollectionInput,
  now: string,
  makeId: () => string = newCollectionId,
): { list: Collection[]; id: string } {
  const name = input.name.trim().slice(0, COLLECTION_NAME_MAX);
  if (!name)
    throw new UserError(
      "err.collections.name",
      "Назовите подборку: название не может быть пустым.",
    );
  const ids = [...new Set(input.productIds.filter((p) => UUID_RE.test(p)))].slice(
    0,
    COLLECTION_PRODUCTS_MAX,
  );
  const existing = input.id ? list.find((c) => c.id === input.id) : undefined;
  if (existing)
    return {
      id: existing.id,
      list: list.map((c) => (c.id === existing.id ? { ...c, name, product_ids: ids } : c)),
    };
  if (list.length >= COLLECTIONS_MAX)
    throw new UserError("err.collections.limit", "Подборок не больше {n}: удалите ненужную.", {
      n: COLLECTIONS_MAX,
    });
  let id = makeId();
  while (list.some((c) => c.id === id)) id = makeId();
  return { id, list: [...list, { id, name, product_ids: ids, created_at: now }] };
}

export const removeCollection = (list: readonly Collection[], id: string): Collection[] =>
  list.filter((c) => c.id !== id);

/** Ссылка на страницу подборки — её даём в бота, Instagram и рассылки; `base` — адрес витрины (`.../s/<магазин>`). */
export const collectionUrl = (base: string, id: string) => `${base}/col/${encodeURIComponent(id)}`;
