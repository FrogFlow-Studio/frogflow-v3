/**
 * «Часто покупают» (Л2): сколько разных покупателей получили товар. Считается по настоящим
 * заказам: только статус «выдан» (оплата подтверждена, возврат статус снимает); ждущие оплаты,
 * отменённые и отклонённые не в счёте. Один покупатель сколько бы раз ни заказывал товар даёт
 * единицу, а почта сайта без подтверждения заказа не выдаёт: накрутить счёт нельзя. Цифры раз в
 * час кладёт крон площадки в `app_settings.marketplace_popular` магазина.
 */
export const POPULAR_KEY = "marketplace_popular";
export const POPULAR_WINDOW_DAYS = 90;
/** Меньше стольких разных покупателей — это не «часто покупают». */
export const POPULAR_MIN_BUYERS = 2;
/** Сколько товаров магазина храним. */
export const POPULAR_PER_SHOP = 30;
/** В ленте площадки от одного магазина не больше стольких: ленту не занимает один автор. */
export const FEED_PER_SHOP = 4;
export const FEED_SIZE = 12;

export type Popular = {
  v: 1;
  /** Когда посчитано (ISO). */
  at: string;
  /** Товар → число разных покупателей, по убыванию. */
  items: Array<{ id: string; n: number }>;
};

/** Позиции выданных заказов → лучшие товары магазина. */
export function buildPopular(
  rows: ReadonlyArray<{ productId: string; buyer: number }>,
  now: Date,
): Popular {
  const buyers = new Map<string, Set<number>>();
  for (const r of rows) {
    const set = buyers.get(r.productId) ?? new Set<number>();
    set.add(r.buyer);
    buyers.set(r.productId, set);
  }
  const items = [...buyers]
    .map(([id, set]) => ({ id, n: set.size }))
    .filter((i) => i.n >= POPULAR_MIN_BUYERS)
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))
    .slice(0, POPULAR_PER_SHOP);
  return { v: 1, at: now.toISOString(), items };
}

export function parsePopular(raw: string | null | undefined): Popular | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Popular>;
    if (p.v !== 1 || !Array.isArray(p.items)) return null;
    const items = p.items.filter(
      (i): i is { id: string; n: number } =>
        !!i && typeof i.id === "string" && Number.isInteger(i.n) && i.n >= 1,
    );
    return { v: 1, at: typeof p.at === "string" ? p.at : "", items };
  } catch {
    return null;
  }
}

/** Не больше `perShop` позиций одного магазина, порядок сохраняется. */
export function capPerShop<T extends { shopId: string }>(
  list: readonly T[],
  perShop: number = FEED_PER_SHOP,
  size: number = FEED_SIZE,
): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const x of list) {
    const k = seen.get(x.shopId) ?? 0;
    if (k >= perShop) continue;
    seen.set(x.shopId, k + 1);
    out.push(x);
    if (out.length >= size) break;
  }
  return out;
}
