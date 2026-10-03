import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sortCatalog, type CatalogSort } from "./sort";
import { shownLeadDays } from "@/core/catalog/lead-time";
import { productFiles, type ProductFile } from "./product-files";
import { listAllCategories } from "@/core/catalog/admin";
import {
  PRODUCT_SELECT,
  productSearchFilter,
  searchPattern,
  sortedImages,
  sortedVariants,
  type Product,
} from "@/core/catalog/catalog";
import { imagePath } from "@/core/catalog/image-url";
import { resolveListPrice, resolvePrice } from "@/core/pricing/pricing";
import { offerForProduct } from "@/core/offers/offers";
import { productSellable } from "@/core/catalog/materials";
import { getSettings } from "@/core/settings/settings";
import { eachPage, pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import type { Locale } from "@/core/i18n/locale";
import { languageChips } from "./lang-filter";
import { priceRange } from "./filters";
import { listedOnStorefront } from "./sitemap";
import { STORE_PAGE } from "./paging";
import {
  categorySubtree,
  parseCatalogLayout,
  productOnStorefront,
  visibleCategoryIds,
  type CatalogLayout,
} from "./categories";

/** Публичное представление товара для витрины и Mini App — без серверных полей. */
export type StoreProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  priceFrom: boolean;
  currency: string;
  images: string[];
  /** oldPrice — цена без акции, когда на товар действует акция (иначе null). */
  variants: Array<{
    id: string;
    name: string;
    price: number;
    currency: string;
    oldPrice: number | null;
  }>;
  categoryIds: string[];
  kind: "digital" | "physical";
  inStock: boolean;
  leadTimeDays: number | null;
  rating: { avg: number; count: number } | null;
  languages: string[];
  /**
   * Действующая акция («Ограниченные предложения», core/offers): цена выше
   * уже со скидкой, здесь — прежняя цена, процент, конец и остаток. Сроки
   * показываются в часовом поясе магазина (tz).
   */
  offer: {
    percent: number;
    oldPrice: number;
    endsAt: string;
    left: number | null;
    tz: string;
  } | null;
  /** Файлы материала — только на странице товара (storeProduct), в каталоге не нужны. */
  files?: ProductFile[];
};

export type StoreInfo = {
  botId: string;
  slug: string;
  name: string;
  vertical: string;
  botUsername: string | null;
  contactLink: string | null;
  currency: string;
  accent: string | null;
  miniApp: boolean;
  /** Чипы языков материала над каталогом (модуль multi_language). */
  langFilter: boolean;
  /** Модуль «Склад»: на главной есть фильтр «в наличии». */
  stockFilter: boolean;
  /** Короткий текст «О продавце» для шапки витрины. */
  tagline: string | null;
  categories: Array<{ id: string; name: string; parent_id: string | null }>;
  /** Раскладка верхнего ряда категорий (mini_app_catalog, как в v1). */
  catalogLayout: CatalogLayout;
  legal: Record<string, boolean>;
};

export async function storeInfo(ctx: TenantContext): Promise<StoreInfo> {
  const [cats, s] = await Promise.all([
    listAllCategories(ctx),
    getSettings(ctx, [
      "shop_name",
      "admin_contact_link",
      "legal_offer",
      "legal_privacy",
      "legal_requisites",
      "legal_about",
      "shop_currency",
      "shop_tagline",
      "storefront_accent",
      "mini_app_catalog",
    ]),
  ]);
  const visible = visibleCategoryIds(cats);
  const legalOn = Boolean(ctx.tenant.modules.legal_docs);
  return {
    botId: ctx.tenant.id,
    slug: ctx.tenant.settings.slug ?? ctx.tenant.id,
    name: s.shop_name ?? ctx.tenant.name,
    vertical: ctx.tenant.vertical,
    botUsername: ctx.tenant.settings.telegram?.username ?? null,
    contactLink: s.admin_contact_link ?? null,
    currency: (s.shop_currency ?? "KZT").toUpperCase(),
    /** Акцентный цвет витрины (#rrggbb) из настроек продавца; нет — тема платформы. */
    accent: /^#[0-9a-f]{6}$/i.test(s.storefront_accent ?? "") ? s.storefront_accent! : null,
    miniApp: Boolean(ctx.tenant.modules.telegram_mini_app && ctx.tenant.modules.shop),
    langFilter: Boolean(ctx.tenant.modules.multi_language),
    stockFilter: Boolean(ctx.tenant.modules.stock),
    tagline: s.shop_tagline?.trim()
      ? s.shop_tagline.trim().slice(0, 160)
      : s.legal_about
        ? s.legal_about
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160) || null
        : null,
    categories: cats
      .filter((c) => visible.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
    catalogLayout: parseCatalogLayout(s.mini_app_catalog),
    // Ссылки на юр. страницы — только при модуле legal_docs (core/storefront/access).
    legal: {
      offer: legalOn && Boolean(s.legal_offer),
      privacy: legalOn && Boolean(s.legal_privacy),
      requisites: legalOn && Boolean(s.legal_requisites),
      about: legalOn && Boolean(s.legal_about),
    },
  };
}

/** Товар можно купить: остаток не нулевой (или не ведётся, или модуль «Склад» выключен). */
function isInStock(ctx: TenantContext, p: Pick<Product, "stock_quantity">): boolean {
  return !(ctx.tenant.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0);
}

async function toStoreProduct(ctx: TenantContext, p: Product): Promise<StoreProduct> {
  const variants = sortedVariants(p);
  const priced = variants.length
    ? await Promise.all(variants.map(async (v) => ({ v, m: await resolvePrice(ctx, p, null, v) })))
    : [];
  const base = await resolvePrice(ctx, p, null);
  const min = priced.length ? priced.reduce((a, b) => (b.m.amount < a.m.amount ? b : a)) : null;
  // Цена выше уже со скидкой акции (resolvePrice); прежняя — без неё.
  const offer = await offerForProduct(ctx, p.id);
  const oldOf = async (v: (typeof variants)[number] | null) =>
    offer ? (await resolveListPrice(ctx, p, null, v)).amount : null;
  const oldVariants = new Map(
    await Promise.all(priced.map(async ({ v }) => [v.id, await oldOf(v)] as const)),
  );
  const oldPrice = offer ? await oldOf(min ? min.v : null) : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    price: min ? min.m.amount : base.amount,
    priceFrom: Boolean(min),
    currency: min ? min.m.currency : base.currency,
    images: sortedImages(p).map((i) => imagePath(ctx.tenant.id, i.image_path)),
    variants: priced.map(({ v, m }) => ({
      id: v.id,
      name: v.name,
      price: m.amount,
      currency: m.currency,
      oldPrice: oldVariants.get(v.id) ?? null,
    })),
    categoryIds: Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [],
    kind: p.fulfillment_kind === "physical" ? "physical" : "digital",
    inStock: isInStock(ctx, p),
    leadTimeDays: shownLeadDays(p),
    rating: p.rating_count ? { avg: Number(p.rating_avg ?? 0), count: p.rating_count } : null,
    languages: productLanguages(ctx, p),
    offer:
      offer && oldPrice != null
        ? {
            percent: offer.percent,
            oldPrice,
            endsAt: offer.ends_at,
            left: offer.left,
            tz: ctx.timezone,
          }
        : null,
  };
}

/**
 * Активные товары в порядке выбранной сортировки; в конце — id, чтобы
 * равные товары не менялись местами и страницы не перекрывались.
 */
function catalogQuery(ctx: TenantContext, sort: CatalogSort, search: string | null) {
  let q = ctx.db.from("products").select(PRODUCT_SELECT).eq("is_active", true);
  if (sort === "popular")
    q = q
      .order("rating_count", { ascending: false, nullsFirst: false })
      .order("rating_avg", { ascending: false, nullsFirst: false });
  else if (sort === "new") q = q.order("created_at", { ascending: false });
  else if (sort === "price") q = q.order("price");
  else q = q.order("sort_order").order("name");
  q = q.order("id");
  return search ? q.or(search) : q;
}

/**
 * Цена для фильтра «от–до»: наименьшая цена варианта (витрина показывает
 * «от …»), без вариантов — базовая; в валюте товара, до акций и курса. В
 * запрос цена не уходит: у товара с вариантами колонка products.price не
 * говорит, сколько он стоит «от», поэтому проверка точная, после чтения
 * страницы, а листание идёт по отфильтрованным товарам без потерь.
 */
export function filterPrice(p: Pick<Product, "price" | "product_variants">): number {
  const vs = (p.product_variants ?? []).map((v) => Number(v.price)).filter(Number.isFinite);
  return vs.length ? Math.min(...vs) : Number(p.price) || 0;
}

export { STORE_PAGE };

/**
 * Языки материалов товара для чипов RU/KZ. Без модуля multi_language
 * выдаётся только русский (itemAvailableLanguages), поэтому языков на
 * витрине нет, сколько бы файлов ни было заведено.
 */
function productLanguages(ctx: TenantContext, p: Product): string[] {
  if (!ctx.tenant.modules.multi_language) return [];
  return (p.product_material_files ?? [])
    .map((f) => f.language ?? "ru")
    .filter((l, i, a) => a.indexOf(l) === i);
}

/**
 * Страница каталога витрины по всему каталогу, без потолка в 200: товары
 * читаются из базы страницами уже в порядке сортировки, видимость — как у
 * карты сайта и разметки (listedOnStorefront). Язык фильтруется здесь же,
 * до деления на страницы, а чипы языков строятся по всему каталогу — для
 * этого при модуле multi_language каталог читается целиком; без него
 * чтение останавливается, как только набралась страница и ещё один товар.
 */
export async function storeCatalogPage(
  ctx: TenantContext,
  opts: {
    q?: string;
    categoryId?: string | null;
    sort?: CatalogSort;
    lang?: string | null;
    /** Только товары, которые можно купить сейчас (фильтр «в наличии»). */
    inStock?: boolean;
    /** Цена от и до включительно, в валюте магазина; null — граница не задана. */
    minPrice?: number | null;
    maxPrice?: number | null;
    offset?: number;
    limit?: number;
  } = {},
): Promise<{ items: StoreProduct[]; hasMore: boolean; languages: Locale[] }> {
  const sort = opts.sort ?? "catalog";
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(Math.max(1, opts.limit ?? STORE_PAGE), 100);
  const pattern = searchPattern(opts.q ?? "");
  const [search, cats] = await Promise.all([
    pattern ? productSearchFilter(ctx, pattern) : Promise.resolve(null),
    listAllCategories(ctx),
  ]);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  const wanted = opts.categoryId ? categorySubtree(cats, opts.categoryId, visible) : null;
  const multiLang = Boolean(ctx.tenant.modules.multi_language);
  const need = offset + limit + 1;
  const price = priceRange(opts.minPrice, opts.maxPrice);
  const listed: Array<{ p: Product; langs: string[] }> = [];
  await eachPage<Product>(
    (a, b) => catalogQuery(ctx, sort, search).range(a, b),
    "store catalog",
    (rows) => {
      for (const p of rows) {
        const ids = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
        if (wanted && !ids.some((id) => wanted.has(id))) continue;
        if (opts.inStock && !isInStock(ctx, p)) continue;
        if (price.min !== null || price.max !== null) {
          const fp = filterPrice(p);
          if ((price.min !== null && fp < price.min) || (price.max !== null && fp > price.max))
            continue;
        }
        if (!listedOnStorefront(p, known, visible)) continue;
        listed.push({ p, langs: productLanguages(ctx, p) });
        if (!multiLang && listed.length >= need) return false;
      }
      return true;
    },
    500,
  );
  const languages = languageChips(listed.map((x) => ({ languages: x.langs })));
  const lang = opts.lang && languages.includes(opts.lang as Locale) ? opts.lang : null;
  const shown = lang ? listed.filter((x) => x.langs.includes(lang)) : listed;
  const page = shown.slice(offset, offset + limit);
  return {
    items: await Promise.all(page.map((x) => toStoreProduct(ctx, x.p))),
    hasMore: shown.length > offset + limit,
    languages,
  };
}

export async function storeCatalog(
  ctx: TenantContext,
  opts: { q?: string; categoryId?: string | null; sort?: CatalogSort } = {},
): Promise<StoreProduct[]> {
  // Выбранная категория включает подкатегории (как в v1), а jsonb-массив
  // category_ids одним запросом на «любой из» не отфильтровать — фильтруем
  // здесь, по всему активному каталогу.
  // Порядок — в запросе, а не только после него: иначе «Новые» и «Цена»
  // сортировали бы первые N товаров порядка продавца, а не весь каталог.
  // В конце каждого порядка — id, чтобы равные товары не менялись местами.
  const sort = opts.sort ?? "catalog";
  const pattern = searchPattern(opts.q ?? "");
  const search = pattern ? await productSearchFilter(ctx, pattern) : null;
  // Весь активный каталог постранично: порядок кончается id, страницы не пересекаются.
  const [data, cats] = await Promise.all([
    pageAll<Product>(
      (from, to) => catalogQuery(ctx, sort, search).range(from, to) as never,
      "Витрина: каталог",
    ),
    listAllCategories(ctx),
  ]);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  const wanted = opts.categoryId ? categorySubtree(cats, opts.categoryId, visible) : null;
  const rows = data.filter((p) => {
    const ids = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
    if (wanted && !ids.some((id) => wanted.has(id))) return false;
    return productOnStorefront(ids, known, visible);
  });
  // Сортировка — после фильтров и до обрезки списка, как в v1.
  const sellable = sortCatalog(
    rows.filter((p) => p.fulfillment_kind === "physical" || productSellable(p)),
    sort,
  ).slice(0, 200);
  return Promise.all(sellable.map((p) => toStoreProduct(ctx, p)));
}

/**
 * Товары по списку id — избранное покупателя на сайте. Порядок как в списке;
 * снятое с продажи, скрытое и без материалов не отдаём (страница «Избранное»
 * тихо убирает их из браузера).
 */
export async function storeProductsByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<StoreProduct[]> {
  if (ids.length === 0) return [];
  const [rows, cats] = await Promise.all([
    inChunks(
      ids,
      (chunk) =>
        ctx.db.from("products").select(PRODUCT_SELECT).in("id", chunk).eq("is_active", true),
      "Витрина",
    ),
    listAllCategories(ctx),
  ]);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  const byId = new Map((rows as Product[]).map((p) => [p.id, p]));
  const shown = ids
    .map((id) => byId.get(id))
    .filter((p): p is Product => Boolean(p) && listedOnStorefront(p!, known, visible));
  return Promise.all(shown.map((p) => toStoreProduct(ctx, p)));
}

/**
 * «С этим берут» в корзине витрины и Mini App — те же правила, что в боте и
 * Instagram/WhatsApp (core/upsell: правила продавца, иначе популярное из тех
 * же категорий). Сверху — фильтры витрины: скрытые категории и товары без
 * материалов не предлагаем. Кандидатов берём с запасом, чтобы после фильтров
 * осталось до трёх.
 */
export async function storeUpsell(
  ctx: TenantContext,
  cartIds: readonly string[],
): Promise<StoreProduct[]> {
  if (!ctx.tenant.modules.upsell || cartIds.length === 0) return [];
  const { upsellFor, UPSELL_MAX } = await import("@/core/upsell/upsell");
  const ids = (await upsellFor(ctx, cartIds, UPSELL_MAX * 3)).map((o) => o.id);
  if (ids.length === 0) return [];
  const [data, cats] = await Promise.all([
    inChunks(
      ids,
      (chunk) =>
        ctx.db.from("products").select(PRODUCT_SELECT).in("id", chunk).eq("is_active", true),
      "Витрина: допродажа",
    ),
    listAllCategories(ctx),
  ]);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  const byId = new Map((data as Product[]).map((p) => [p.id, p]));
  const shown = ids
    .map((id) => byId.get(id))
    .filter((p): p is Product => {
      if (!p) return false;
      const catIds = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
      return (
        productOnStorefront(catIds, known, visible) &&
        (p.fulfillment_kind === "physical" || productSellable(p))
      );
    })
    .slice(0, UPSELL_MAX);
  return Promise.all(shown.map((p) => toStoreProduct(ctx, p)));
}

export async function storeProduct(ctx: TenantContext, id: string): Promise<StoreProduct | null> {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (dataError) throw serverFailure(`Витрина: ${dataError.message}`);
  if (!data) return null;
  const files = productFiles(data as Product, Boolean(ctx.tenant.modules.multi_language));
  return { ...(await toStoreProduct(ctx, data as Product)), files };
}
