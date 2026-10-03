import type Anthropic from "@anthropic-ai/sdk";
import { productCategoryIds } from "@/core/catalog/category-ids";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { allActiveProducts } from "@/core/catalog/active";
import { pageAll } from "@/core/db/page";
import { resolvePrice } from "@/core/pricing/pricing";
import {
  assortmentMap,
  searchCatalog,
  type CatalogItem,
  type CatalogQuery,
} from "./catalog-search";

/**
 * Каталог консультанта через инструменты: модель ищет сама, в подсказке —
 * только карта ассортимента. Включает оператор у клиента
 * (`bots.settings.consultant_search`); без флага консультант работает по-старому,
 * со списком первых товаров в подсказке.
 */

export function catalogSearchEnabled(ctx: TenantContext): boolean {
  return ctx.tenant.settings.consultant_search === true;
}

type ProductLite = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  price: number;
  currency: string | null;
  stock_quantity: number | null;
  category_id: string | null;
  category_ids: unknown;
  country_prices: unknown;
  product_variants: Array<{ id: string; name: string; price: number; sort_order: number }> | null;
};

const COLUMNS =
  "id, name, description, keywords, price, currency, stock_quantity, category_id, category_ids, country_prices, product_variants(id, name, price, sort_order)";

export type LoadedCatalog = {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
};

/**
 * Каталог на минуту в памяти экземпляра: покупатель пишет несколько сообщений
 * подряд, а читать сотни товаров на каждое незачем. Цены за минуту меняются
 * так же, как у витрины (кеш акций и курсов — тоже минута).
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; catalog: LoadedCatalog }>();
/** Каталогов в памяти не больше стольких магазинов: вытесняется самый давний. */
const CACHE_TENANTS = 50;

export function resetCatalogCache(): void {
  cache.clear();
}

/**
 * Весь ассортимент в продаже, постранично (у BOVI ~880 позиций, у крупных —
 * больше 1000). Цены — как у витрины: resolvePrice (акции, валюта клиента),
 * чтобы карта «от», бюджет и карточки говорили одно. Остаток — только если у
 * клиента включён учёт остатков, как в карточке товара.
 */
export async function loadCatalog(ctx: TenantContext, now = Date.now()): Promise<LoadedCatalog> {
  const hit = cache.get(ctx.tenant.id);
  if (hit && now - hit.at < CACHE_MS) return hit.catalog;
  const [rows, cats] = await Promise.all([
    allActiveProducts<ProductLite>(ctx, COLUMNS),
    pageAll<{ id: string; name: string }>(
      (from, to) => ctx.db.from("categories").select("id, name").order("id").range(from, to),
      "категории для консультанта",
    ),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const trackStock = Boolean(ctx.tenant.modules.stock);
  const items = await Promise.all(
    rows.map(async (r): Promise<CatalogItem> => {
      const cat = productCategoryIds(r)
        .map((id) => catName.get(id))
        .find(Boolean);
      const priced = r as unknown as Parameters<typeof resolvePrice>[1];
      const base = await resolvePrice(ctx, priced, null);
      const variants = await Promise.all(
        [...(r.product_variants ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(async (v) => ({
            name: v.name,
            price: (await resolvePrice(ctx, priced, null, v)).amount,
          })),
      );
      return {
        id: r.id,
        name: r.name,
        category: cat ?? null,
        description: r.description ?? "",
        keywords: r.keywords ?? "",
        price: base.amount,
        currency: base.currency,
        stock: trackStock ? r.stock_quantity : null,
        variants,
      };
    }),
  );
  const catalog = { items, byId: new Map(items.map((it) => [it.id, it])) };
  cache.delete(ctx.tenant.id);
  cache.set(ctx.tenant.id, { at: now, catalog });
  if (cache.size > CACHE_TENANTS) cache.delete(cache.keys().next().value!);
  return catalog;
}

export function catalogPromptSection(catalog: LoadedCatalog): string {
  if (!catalog.items.length) return "";
  return `АССОРТИМЕНТ (карта по категориям; конкретные товары, цены и наличие — только инструментом search_products):
${assortmentMap(catalog.items)}`;
}

export const CATALOG_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Поиск по каталогу магазина: свободный текст, категория, размер, бюджет. Вызывайте перед тем, как назвать любой товар, цену, размер или наличие. Пустой список — ничего не нашлось: не придумывайте товары и не предлагайте другую категорию вместо запрошенной. total_matches больше числа карточек — назовите общее число и предложите сузить выбор. Широкий запрос (только категория или марка) возвращается сводкой summary без карточек: тогда не перечисляйте товары, скажите одной строкой, что есть и от какой цены, и задайте один вопрос — о размере, цвете или назначении. cheapest_ignoring_price_limit — в бюджет не вошло ничего, это самая дешёвая позиция: назовите её прямо.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Что ищет клиент, его словами" },
        category: { type: "string", description: "Категория, если клиент её назвал" },
        size: { type: "string", description: "Размер, например 200x220" },
        max_price: { type: "number", description: "Бюджет клиента — верхняя граница цены" },
        show_all: {
          type: "boolean",
          description: "Клиент прямо просит показать всё — вернуть карточки даже на широкий запрос",
        },
      },
    },
  },
  {
    name: "get_product",
    description:
      "Карточка одного товара по id из результатов поиска: описание, варианты, цены, наличие.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
];

export const CATALOG_TOOL_NAMES = new Set(CATALOG_TOOLS.map((t) => t.name));

/** Карточка для модели; цены уже посчитаны как у витрины (loadCatalog). */
function card(
  item: CatalogItem,
  full: boolean,
): { card: Record<string, unknown>; prices: number[] } {
  return {
    card: {
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.variants.length ? undefined : `${item.price} ${item.currency}`,
      variants: item.variants.length
        ? item.variants.map((v) => `${v.name} — ${v.price} ${item.currency}`)
        : undefined,
      in_stock: item.stock == null || item.stock > 0,
      description: full ? item.description.slice(0, 1500) : item.description.slice(0, 200),
    },
    prices: [item.price, ...item.variants.map((v) => v.price)],
  };
}

export type ToolRun = { result: string; prices: number[] };

/** Выполнить инструмент каталога; ответ — JSON строкой для tool_result. */
export function runCatalogTool(
  catalog: LoadedCatalog,
  name: string,
  input: Record<string, unknown>,
): ToolRun {
  if (name === "get_product") {
    const item = catalog.byId.get(String(input.product_id ?? ""));
    if (!item) return { result: JSON.stringify({ found: false }), prices: [] };
    const c = card(item, true);
    return { result: JSON.stringify({ found: true, product: c.card }), prices: c.prices };
  }
  const q: CatalogQuery = {
    query: typeof input.query === "string" ? input.query.slice(0, 200) : undefined,
    category: typeof input.category === "string" ? input.category.slice(0, 100) : undefined,
    size: typeof input.size === "string" ? input.size.slice(0, 40) : undefined,
    max_price:
      typeof input.max_price === "number" && Number.isFinite(input.max_price)
        ? input.max_price
        : undefined,
    show_all: input.show_all === true,
  };
  const found = searchCatalog(catalog.items, q);
  const prices: number[] = [];
  const cards = found.items.map((it) => {
    const c = card(it, false);
    prices.push(...c.prices);
    return c.card;
  });
  let cheapest: Record<string, unknown> | undefined;
  if (found.cheapest_ignoring_price_limit) {
    const c = card(found.cheapest_ignoring_price_limit, false);
    prices.push(...c.prices);
    cheapest = c.card;
  }
  if (found.summary) prices.push(found.summary.price_from, found.summary.price_to);
  return {
    result: JSON.stringify({
      total_matches: found.total_matches,
      items: cards,
      ...(found.summary ? { summary: found.summary, ask_size_and_color: true } : {}),
      ...(cheapest ? { cheapest_ignoring_price_limit: cheapest } : {}),
    }),
    prices,
  };
}
