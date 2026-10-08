/**
 * «Контекст списка» витрины (Т3 и Т4 пожеланий Кристины): из какого списка открыт товар.
 * Каталог запоминает показанные товары (с догруженными «Показать ещё») и открытый товар;
 * карточка по нему листает соседей, каталог при возврате восстанавливает список и место.
 * Хранится в sessionStorage браузера, сервер его не видит. Без базы — для браузера.
 */
import type { StoreProduct } from "@/core/storefront/catalog";
import type { CatalogSort } from "@/core/storefront/sort";

/** Сохранённое старше этого не используем: каталог мог измениться. */
export const LIST_TTL_MS = 30 * 60 * 1000;

/** Запрос страницы каталога без смещения — чтобы карточка могла догрузить следующую. */
export type ListQuery = {
  slug: string;
  q?: string;
  category?: string;
  sort?: CatalogSort;
  lang?: string;
  stock?: boolean;
  sale?: boolean;
  bundles?: boolean;
  min?: number;
  max?: number;
};

export type ListContext = {
  v: 1;
  /** Ключ списка: магазин + поиск, категория, фильтры, сортировка, страница. */
  key: string;
  /** Когда сохранено (мс). */
  at: number;
  /** Номер записи истории, на которой стоит список (`__TSR_index` роутера). */
  listIndex: number;
  /** Все показанные товары по порядку. */
  ids: string[];
  /** Товары, догруженные сверх первой страницы. */
  extra: StoreProduct[];
  hasMore: boolean;
  /** Открытый (или долистанный) товар — к нему каталог прокручивает при возврате. */
  current: string | null;
  query: ListQuery;
  /** Смещение первой показанной страницы (адрес `?page=N`). */
  firstOffset: number;
};

export const listStorageKey = (slug: string) => `ff-list-${slug}`;

/** Разобрать сохранённое; битое, чужого магазина или устаревшее — null. */
export function parseListContext(
  raw: string | null,
  slug: string,
  now: number,
): ListContext | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<ListContext>;
    if (
      c.v !== 1 ||
      typeof c.key !== "string" ||
      typeof c.at !== "number" ||
      typeof c.listIndex !== "number" ||
      !Array.isArray(c.ids) ||
      !c.ids.every((id) => typeof id === "string") ||
      !Array.isArray(c.extra) ||
      typeof c.hasMore !== "boolean" ||
      !c.query ||
      c.query.slug !== slug ||
      typeof c.firstOffset !== "number"
    )
      return null;
    if (now - c.at > LIST_TTL_MS || c.at > now + 60_000) return null;
    return {
      v: 1,
      key: c.key,
      at: c.at,
      listIndex: c.listIndex,
      ids: c.ids,
      extra: c.extra,
      hasMore: c.hasMore,
      current: typeof c.current === "string" ? c.current : null,
      query: c.query,
      firstOffset: c.firstOffset,
    };
  } catch {
    return null;
  }
}

/**
 * Восстанавливать ли список: тот же список и та же запись истории («Назад» к нему или
 * перезагрузка). Новый вход в каталог — новая запись истории, начинаем сверху.
 */
export function restorable(ctx: ListContext | null, key: string, historyIndex: number) {
  return ctx && ctx.key === key && ctx.listIndex === historyIndex ? ctx : null;
}

export type ListPosition = {
  index: number;
  total: number;
  hasMore: boolean;
  prev: string | null;
  next: string | null;
};

/**
 * Место товара в списке, если карточка открыта из него: на следующей за списком записи
 * истории (листание заменяет адрес, номер записи не меняется). По прямой ссылке — null.
 */
export function listPosition(
  ctx: ListContext | null,
  productId: string,
  historyIndex: number,
): ListPosition | null {
  if (!ctx || ctx.listIndex + 1 !== historyIndex) return null;
  const index = ctx.ids.indexOf(productId);
  if (index < 0) return null;
  return {
    index,
    total: ctx.ids.length,
    hasMore: ctx.hasMore,
    prev: index > 0 ? ctx.ids[index - 1]! : null,
    next: index + 1 < ctx.ids.length ? ctx.ids[index + 1]! : null,
  };
}

/** Догрузили страницу на карточке: новые товары в конец, без повторов. */
export function appendPage(
  ctx: ListContext,
  items: StoreProduct[],
  hasMore: boolean,
  now: number,
): ListContext {
  const seen = new Set(ctx.ids);
  const fresh = items.filter((p) => !seen.has(p.id));
  return {
    ...ctx,
    at: now,
    ids: [...ctx.ids, ...fresh.map((p) => p.id)],
    extra: [...ctx.extra, ...fresh],
    hasMore,
  };
}

/**
 * Куда прокрутить при возврате: открытый товар, а если его больше нет в списке
 * (скрыт, удалён) — ближайший сосед по сохранённому порядку.
 */
export function scrollTarget(
  ids: readonly string[],
  current: string | null,
  present: ReadonlySet<string>,
): string | null {
  if (!current) return null;
  if (present.has(current)) return current;
  const at = ids.indexOf(current);
  if (at < 0) return null;
  for (let d = 1; d < ids.length; d++) {
    const after = ids[at + d];
    if (after !== undefined && present.has(after)) return after;
    const before = ids[at - d];
    if (before !== undefined && present.has(before)) return before;
  }
  return null;
}

/** Горизонтальный свайп: длиннее порога и заметно горизонтальнее вертикального. */
export function swipeDirection(dx: number, dy: number): "next" | "prev" | null {
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return null;
  return dx < 0 ? "next" : "prev";
}
