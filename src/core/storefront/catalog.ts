import type { TenantContext } from "@/core/tenant/resolve.server";
import { listAllCategories } from "@/core/catalog/admin";
import { PRODUCT_SELECT, sortedImages, sortedVariants, type Product } from "@/core/catalog/catalog";
import { imagePath } from "@/core/catalog/image-url";
import { resolvePrice } from "@/core/pricing/pricing";
import { productSellable } from "@/core/catalog/materials";
import { getSettings } from "@/core/settings/settings";

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
      .filter((c) => c.is_visible)
      .map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
    legal: {
      offer: Boolean(s.legal_offer),
      privacy: Boolean(s.legal_privacy),
      requisites: Boolean(s.legal_requisites),
      about: Boolean(s.legal_about),
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
    leadTimeDays: p.lead_time_days,
    rating: p.rating_count ? { avg: Number(p.rating_avg ?? 0), count: p.rating_count } : null,
    languages: (p.product_material_files ?? [])
      .map((f) => f.language ?? "ru")
      .filter((l, i, a) => a.indexOf(l) === i),
  };
}

export async function storeCatalog(
  ctx: TenantContext,
  opts: { q?: string; categoryId?: string | null } = {},
): Promise<StoreProduct[]> {
  let q = ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .order("name")
    .limit(200);
  if (opts.categoryId) q = q.contains("category_ids", JSON.stringify([opts.categoryId]));
  if (opts.q?.trim()) {
    const s = `%${opts.q
      .trim()
      .replace(/[%_,()]/g, " ")
      .slice(0, 80)}%`;
    q = q.or(`name.ilike.${s},keywords.ilike.${s},description.ilike.${s}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Product[];
  const sellable = rows.filter((p) => p.fulfillment_kind === "physical" || productSellable(p));
  return Promise.all(sellable.map((p) => toStoreProduct(ctx, p)));
}

export async function storeProduct(ctx: TenantContext, id: string): Promise<StoreProduct | null> {
  const { data } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  return data ? toStoreProduct(ctx, data as Product) : null;
}
