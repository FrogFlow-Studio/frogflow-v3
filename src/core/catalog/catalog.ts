import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { imagePath } from "./image-url";
import { fuzzyIds } from "./fuzzy";

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
  if (error) throw serverFailure(`categories: ${error.message}`);
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
  if (error) throw serverFailure(`products: ${error.message}`);
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
 * id всех товаров, подходящих под поисковый шаблон: по названию, ключевым
 * словам, описанию и названию варианта. Всё постранично, без потолка в 1000 и
 * без длинного фильтра в адресе: витрина отбирает по этому набору сама.
 */
export async function productSearchIds(ctx: TenantContext, pattern: string): Promise<Set<string>> {
  const [byText, byVariant] = await Promise.all([
    pageAll<{ id: string }>(
      (from, to) =>
        ctx.db
          .from("products")
          .select("id")
          .or(`name.ilike.${pattern},keywords.ilike.${pattern},description.ilike.${pattern}`)
          .order("id")
          .range(from, to),
      "Поиск по товарам",
    ),
    pageAll<{ product_id: string }>(
      (from, to) =>
        ctx.db
          .from("product_variants")
          .select("product_id")
          .ilike("name", pattern)
          .order("id")
          .range(from, to),
      "Поиск по вариантам",
    ),
  ]);
  return new Set([...byText.map((p) => p.id), ...byVariant.map((v) => v.product_id)]);
}

/**
 * Поиск товара: название, ключевые слова, описание и названия вариантов.
 * Варианты — отдельная таблица, поэтому ищем их своим запросом (постранично),
 * а товары с подходящим вариантом читаем кусками по 200 id: длинный `id.in`
 * внутри `or` уходил в адрес запроса (больше ~8 КБ — 431), а совпадения
 * сверх 200 терялись. Результаты объединяются и сортируются как в базе.
 */
export async function searchProducts(
  ctx: TenantContext,
  query: string,
  limit = 50,
): Promise<Product[]> {
  const pattern = searchPattern(query);
  if (!pattern) return [];
  const variants = await pageAll<{ product_id: string }>(
    (from, to) =>
      ctx.db
        .from("product_variants")
        .select("product_id")
        .ilike("name", pattern)
        .order("id")
        .range(from, to),
    "Поиск по вариантам",
  );
  const byText = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .or(`name.ilike.${pattern},keywords.ilike.${pattern},description.ilike.${pattern}`)
    .order("sort_order")
    .order("name")
    .order("id")
    .limit(limit);
  if (byText.error) throw serverFailure(`Поиск: ${byText.error.message}`);
  const byVariant = await inChunks(
    variants.map((v) => v.product_id),
    (chunk) =>
      ctx.db
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("is_active", true)
        .in("id", chunk)
        .order("sort_order")
        .order("name")
        .order("id")
        .limit(limit),
    "Поиск",
  );
  const found = new Map<string, Product>();
  for (const p of [...((byText.data ?? []) as Product[]), ...(byVariant as Product[])])
    found.set(p.id, p);
  return [...found.values()]
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, limit);
}

/**
 * Поиск, который прощает опечатку в одну букву. Сначала обычный поиск; нашёл —
 * его результат. Пусто — сверяем слова запроса с названием и ключевыми словами
 * всех активных товаров (постранично) и читаем найденные.
 */
export async function searchProductsTolerant(
  ctx: TenantContext,
  query: string,
  limit = 50,
): Promise<Product[]> {
  const exact = await searchProducts(ctx, query, limit);
  if (exact.length > 0) return exact;
  const all = await pageAll<{ id: string; name: string; keywords: string | null }>(
    (from, to) =>
      ctx.db
        .from("products")
        .select("id, name, keywords")
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    "Поиск с опечатками",
  );
  const ids = fuzzyIds(
    query,
    all.map((p) => ({ id: p.id, text: `${p.name} ${p.keywords ?? ""}` })),
  ).slice(0, limit);
  if (ids.length === 0) return [];
  const rows = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("is_active", true)
        .in("id", chunk)
        .order("id"),
    "Поиск",
  );
  const byId = new Map((rows as Product[]).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
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
