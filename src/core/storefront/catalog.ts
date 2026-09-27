import type { TenantContext } from "@/core/tenant/resolve.server";
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
import { resolvePrice } from "@/core/pricing/pricing";
import { productSellable } from "@/core/catalog/materials";
import { getSettings } from "@/core/settings/settings";
import { categorySubtree, productOnStorefront, visibleCategoryIds } from "./categories";

/** Публичное представление товара для витрины и Mini App — без серверных полей. */
export type StoreProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  priceFrom: boolean;
  currency: string;
  images: string[];
  variants: Array<{ id: string; name: string; price: number; currency: string }>;
  categoryIds: string[];
  kind: "digital" | "physical";
  inStock: boolean;
  leadTimeDays: number | null;
  rating: { avg: number; count: number } | null;
  languages: string[];
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
  /** Короткий текст «О продавце» для шапки витрины. */
  tagline: string | null;
  categories: Array<{ id: string; name: string; parent_id: string | null }>;
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
    // Ссылки на юр. страницы — только при модуле legal_docs (core/storefront/access).
    legal: {
      offer: legalOn && Boolean(s.legal_offer),
      privacy: legalOn && Boolean(s.legal_privacy),
      requisites: legalOn && Boolean(s.legal_requisites),
      about: legalOn && Boolean(s.legal_about),
    },
  };
}

async function toStoreProduct(ctx: TenantContext, p: Product): Promise<StoreProduct> {
  const variants = sortedVariants(p);
  const priced = variants.length
    ? await Promise.all(variants.map(async (v) => ({ v, m: await resolvePrice(ctx, p, null, v) })))
    : [];
  const base = await resolvePrice(ctx, p, null);
  const min = priced.length ? priced.reduce((a, b) => (b.m.amount < a.m.amount ? b : a)) : null;
  const stockOn = ctx.tenant.modules.stock;
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
    })),
    categoryIds: Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [],
    kind: p.fulfillment_kind === "physical" ? "physical" : "digital",
    inStock: !(stockOn && p.stock_quantity != null && p.stock_quantity <= 0),
    leadTimeDays: shownLeadDays(p),
    rating: p.rating_count ? { avg: Number(p.rating_avg ?? 0), count: p.rating_count } : null,
    // Без модуля multi_language выдаётся только русский (itemAvailableLanguages),
    // поэтому языков на витрине не показываем, сколько бы файлов ни было заведено.
    languages: ctx.tenant.modules.multi_language
      ? (p.product_material_files ?? [])
          .map((f) => f.language ?? "ru")
          .filter((l, i, a) => a.indexOf(l) === i)
      : [],
  };
}

export async function storeCatalog(
  ctx: TenantContext,
  opts: { q?: string; categoryId?: string | null } = {},
): Promise<StoreProduct[]> {
  // Выбранная категория включает подкатегории (как в v1), а jsonb-массив
  // category_ids одним запросом на «любой из» не отфильтровать — фильтруем
  // здесь, по всему активному каталогу.
  let q = ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .order("name")
    .limit(opts.categoryId ? 1000 : 200);
  const pattern = searchPattern(opts.q ?? "");
  if (pattern) q = q.or(await productSearchFilter(ctx, pattern));
  const [{ data, error }, cats] = await Promise.all([q, listAllCategories(ctx)]);
  if (error) throw new Error(error.message);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  const wanted = opts.categoryId ? categorySubtree(cats, opts.categoryId, visible) : null;
  const rows = ((data ?? []) as Product[]).filter((p) => {
    const ids = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
    if (wanted && !ids.some((id) => wanted.has(id))) return false;
    return productOnStorefront(ids, known, visible);
  });
  const sellable = rows
    .filter((p) => p.fulfillment_kind === "physical" || productSellable(p))
    .slice(0, 200);
  return Promise.all(sellable.map((p) => toStoreProduct(ctx, p)));
}

export async function storeProduct(ctx: TenantContext, id: string): Promise<StoreProduct | null> {
  const { data } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const files = productFiles(data as Product, Boolean(ctx.tenant.modules.multi_language));
  return { ...(await toStoreProduct(ctx, data as Product)), files };
}
