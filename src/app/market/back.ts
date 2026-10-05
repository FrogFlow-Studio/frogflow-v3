/**
 * «Вернуться ко всем товарам» (П2): покупатель пришёл в магазин с площадки, и фильтр, с которым
 * он смотрел, запоминается в браузере (sessionStorage) под адресом магазина. Адреса ссылок на
 * площадке не меняются; без записи (ссылка получена напрямую) плашки в магазине нет.
 */
export type MarketBack = {
  /** Откуда пришёл: «Авторы» или «Все товары». */
  to: "/market" | "/market/search";
  /** Фильтр и язык без смещения страницы: возвращаемся в начало того же списка. */
  search: Record<string, string>;
};

const KEY = "ff_market_back:";
const FIELDS = ["lang", "q", "category", "city"] as const;

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function rememberMarketBack(
  slug: string,
  to: MarketBack["to"],
  search: Record<string, unknown>,
  store: Store | null = browserStore(),
): void {
  if (!store) return;
  const clean: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = search[f];
    if (typeof v === "string" && v) clean[f] = v;
  }
  try {
    store.setItem(KEY + slug, JSON.stringify({ to, search: clean } satisfies MarketBack));
  } catch {
    // Хранилище закрыто (приватный режим): плашки не будет, магазин работает как обычно.
  }
}

export function readMarketBack(
  slug: string,
  store: Store | null = browserStore(),
): MarketBack | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY + slug);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MarketBack>;
    if (v.to !== "/market" && v.to !== "/market/search") return null;
    const search: Record<string, string> = {};
    for (const f of FIELDS) {
      const x = (v.search as Record<string, unknown> | undefined)?.[f];
      if (typeof x === "string" && x) search[f] = x;
    }
    return { to: v.to, search };
  } catch {
    return null;
  }
}
