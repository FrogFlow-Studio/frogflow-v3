import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { imagePath } from "./image-url";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];

export type CategoryRow = { id: string; name: string; parent_id: string | null };

export type ProductImage = { image_path: string; sort_order: number };
export type ProductVariant = { id: string; name: string; price: number; sort_order: number };
export type ProductMaterialFile = {
  language: string | null;
  file_path: string | null;
  file_name: string | null;
  sort_order: number | null;
};

export type Product = ProductRow & {
  product_images: ProductImage[] | null;
  product_variants: ProductVariant[] | null;
  product_material_files: ProductMaterialFile[] | null;
};

/** Один select на все места, где нужен товар целиком: карточка, корзина, заказ. */
export const PRODUCT_SELECT =
  "*, product_images(image_path, sort_order), product_variants(id, name, price, sort_order), product_material_files(language, file_path, file_name, sort_order)";

export async function listChildCategories(
  ctx: TenantContext,
  parentId: string | null,
): Promise<CategoryRow[]> {
  const q = ctx.db
    .from("categories")
    .select("id, name, parent_id")
    .eq("is_visible", true)
    .order("sort_order")
    .order("name");
  const { data, error } = parentId
    ? await q.eq("parent_id", parentId)
    : await q.is("parent_id", null);
  if (error) throw new Error(`categories: ${error.message}`);
  return data ?? [];
}

export async function categoryParentId(ctx: TenantContext, id: string): Promise<string | null> {
  const { data, error: dataError } = await ctx.db
    .from("categories")
    .select("parent_id")
    .eq("id", id)
    .maybeSingle();
  if (dataError) throw serverFailure(`Каталог: ${dataError.message}`);
  return data?.parent_id ?? null;
}

/**
 * Товары категории. `category_ids` — jsonb-массив; корень — товары без
 * категорий вовсе (тот же контракт, что у v1: `eq("category_ids", "[]")`).
 */
export async function listProductsInCategory(
  ctx: TenantContext,
  categoryId: string | null,
): Promise<Product[]> {
  const q = ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const { data, error } = categoryId
    ? await q.contains("category_ids", JSON.stringify([categoryId]))
    : await q.eq("category_ids", "[]");
  if (error) throw new Error(`products: ${error.message}`);
  return (data ?? []) as Product[];
}

export async function getProduct(ctx: TenantContext, id: string): Promise<Product | null> {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (dataError) throw serverFailure(`Каталог: ${dataError.message}`);
  return (data as Product | null) ?? null;
}

/** Поисковая фраза → ilike-шаблон; спецсимволы PostgREST-фильтра гасятся. */
export function searchPattern(query: string): string | null {
  const q = query
    .trim()
    .replace(/[%_,()]/g, " ")
    .slice(0, 80);
  return q ? `%${q}%` : null;
}

/**
 * Фильтр `or` для поиска товара: название, ключевые слова, описание и
 * названия вариантов. Варианты — отдельная таблица, её не встроить в `or`
 * по products, поэтому id товаров с подходящим вариантом добавляются как
 * `id.in.(…)`.
 */
export async function productSearchFilter(ctx: TenantContext, pattern: string): Promise<string> {
  const { data, error } = await ctx.db
    .from("product_variants")
    .select("product_id")
    .ilike("name", pattern)
    .limit(200);
  if (error) throw new Error(`search variants: ${error.message}`);
  const ids = [...new Set((data ?? []).map((v) => v.product_id))];
  const text = `name.ilike.${pattern},keywords.ilike.${pattern},description.ilike.${pattern}`;
  return ids.length ? `${text},id.in.(${ids.join(",")})` : text;
}

export async function searchProducts(
  ctx: TenantContext,
  query: string,
  limit = 50,
): Promise<Product[]> {
  const pattern = searchPattern(query);
  if (!pattern) return [];
  const { data, error } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .or(await productSearchFilter(ctx, pattern))
    .order("sort_order")
    .order("name")
    .limit(limit);
  if (error) throw new Error(`search: ${error.message}`);
  return (data ?? []) as Product[];
}

export function sortedImages(p: Pick<Product, "product_images">): ProductImage[] {
  return (p.product_images ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
}

export function sortedVariants(p: Pick<Product, "product_variants">): ProductVariant[] {
  return (p.product_variants ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
}

/** Публичная ссылка на витринную картинку — раздаётся этим же деплоем. */
export function imageUrl(ctx: TenantContext, path: string): string {
  return `${ctx.appUrl}${imagePath(ctx.tenant.id, path)}`;
}
