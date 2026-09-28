import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import { isAdminInputStorageKey, isTenantStorageKey } from "@/core/storage/keys";
import { PRODUCT_SELECT, type Product } from "./catalog";
import { materialCount } from "./materials";
import { pickerTerm } from "./picker";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];

/* ── категории ────────────────────────────────────────────────────── */

export async function listAllCategories(ctx: TenantContext): Promise<CategoryRow[]> {
  const { data, error } = await ctx.db
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type CategoryInput = {
  name: string;
  parentId: string | null;
  sortOrder?: number;
  isVisible?: boolean;
};

export async function createCategory(ctx: TenantContext, input: CategoryInput): Promise<string> {
  const { data, error } = await ctx.db
    .from("categories")
    .insert({
      bot_id: ctx.tenant.id,
      name: input.name,
      parent_id: input.parentId,
      sort_order: input.sortOrder ?? 0,
      is_visible: input.isVisible ?? true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id;
}

export async function updateCategory(
  ctx: TenantContext,
  id: string,
  input: Partial<CategoryInput>,
): Promise<void> {
  if (input.parentId === id)
    throw new UserError("err.catalog.selfParent", "Категория не может быть родителем самой себе.");
  const patch: Database["public"]["Tables"]["categories"]["Update"] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.parentId !== undefined) patch.parent_id = input.parentId;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.isVisible !== undefined) patch.is_visible = input.isVisible;
  const { error } = await ctx.db.from("categories").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCategory(ctx: TenantContext, id: string): Promise<void> {
  const { count } = await ctx.db
    .from("products")
    .select("id", { count: "exact", head: true })
    .contains("category_ids", JSON.stringify([id]));
  if (count)
    throw new UserError(
      "err.catalog.hasProducts",
      "В категории {count} товаров — сначала перенесите их.",
      { count },
    );
  const { count: kids } = await ctx.db
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  if (kids)
    throw new UserError(
      "err.catalog.hasSubcategories",
      "У категории есть подкатегории — сначала удалите их.",
    );
  const { error } = await ctx.db.from("categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── товары ───────────────────────────────────────────────────────── */

export type ProductListRow = {
  id: string;
  name: string;
  price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  fulfillment_kind: string;
  stock_quantity: number | null;
  category_ids: Json;
  created_at: string;
  images: number;
  files: number;
  variants: number;
  cover: string | null;
};

/** Строк на странице списка товаров; следующая — кнопкой «Показать ещё». */
export const PRODUCT_PAGE = 100;

export type ProductListOpts = {
  q?: string;
  categoryId?: string | null;
  onlyInactive?: boolean;
  offset?: number;
};

/**
 * Страница списка товаров. Порядок — sort_order, название и в конце id:
 * без уникального ключа в хвосте товары с одинаковыми позицией и
 * названием могли переезжать между страницами (повтор или пропуск).
 */
export async function listProductsForAdmin(
  ctx: TenantContext,
  opts: ProductListOpts = {},
): Promise<{ rows: ProductListRow[]; total: number; hasMore: boolean }> {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  type Filterable<Q> = {
    ilike(column: "name", pattern: string): Q;
    contains(column: "category_ids", value: string): Q;
    eq(column: "is_active", value: boolean): Q;
  };
  const filtered = <Q extends Filterable<Q>>(q: Q): Q => {
    let r = q;
    const term = pickerTerm(opts.q ?? "");
    if (term) r = r.ilike("name", `%${term}%`);
    if (opts.categoryId) r = r.contains("category_ids", JSON.stringify([opts.categoryId]));
    if (opts.onlyInactive) r = r.eq("is_active", false);
    return r;
  };
  const [page, count] = await Promise.all([
    filtered(
      ctx.db
        .from("products")
        .select(
          "id, name, price, currency, is_active, sort_order, fulfillment_kind, stock_quantity, category_ids, created_at, file_path, file_url, file_path_kz, file_url_kz, product_images(image_path, sort_order), product_material_files(language, file_path), product_variants(id)",
        ),
    )
      .order("sort_order")
      .order("name")
      .order("id")
      .range(offset, offset + PRODUCT_PAGE - 1),
    filtered(ctx.db.from("products").select("id", { count: "exact", head: true })),
  ]);
  if (page.error) throw new Error(page.error.message);
  if (count.error) throw new Error(count.error.message);
  const rows = (page.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    currency: p.currency,
    is_active: p.is_active,
    sort_order: p.sort_order,
    fulfillment_kind: p.fulfillment_kind,
    stock_quantity: p.stock_quantity,
    category_ids: p.category_ids,
    created_at: p.created_at,
    images: p.product_images?.length ?? 0,
    // Товар v1 с файлом в старых полях — не «нет файла» (core/catalog/materials).
    files: materialCount(p),
    variants: p.product_variants?.length ?? 0,
    cover:
      p.product_images?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.image_path ?? null,
  }));
  const total = count.count ?? offset + rows.length;
  return { rows, total, hasMore: offset + rows.length < total };
}

export async function getProductForAdmin(ctx: TenantContext, id: string): Promise<Product | null> {
  const { data } = await ctx.db.from("products").select(PRODUCT_SELECT).eq("id", id).maybeSingle();
  return (data as Product | null) ?? null;
}

export type ProductInput = {
  name: string;
  description: string;
  keywords: string;
  price: number;
  currency: string;
  countryPrices: Record<string, number>;
  categoryIds: string[];
  isActive: boolean;
  sortOrder: number;
  fulfillmentKind: "digital" | "physical";
  stockQuantity: number | null;
  leadTimeDays: number | null;
};

function toRow(ctx: TenantContext, i: ProductInput): ProductInsert {
  return {
    bot_id: ctx.tenant.id,
    name: i.name.trim(),
    description: i.description,
    keywords: i.keywords,
    price: i.price,
    currency: i.currency.toUpperCase(),
    country_prices: i.countryPrices as Json,
    category_ids: i.categoryIds as unknown as Json,
    is_active: i.isActive,
    sort_order: i.sortOrder,
    fulfillment_kind: i.fulfillmentKind,
    stock_quantity: i.stockQuantity,
    lead_time_days: i.leadTimeDays,
  };
}

export async function createProduct(ctx: TenantContext, input: ProductInput): Promise<string> {
  const { data, error } = await ctx.db
    .from("products")
    .insert(toRow(ctx, input))
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id;
}

export async function updateProduct(
  ctx: TenantContext,
  id: string,
  input: ProductInput,
): Promise<void> {
  const { bot_id: _b, ...patch } = toRow(ctx, input);
  const { error } = await ctx.db.from("products").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteProduct(ctx: TenantContext, id: string): Promise<void> {
  const { data: p } = await ctx.db
    .from("products")
    .select("product_images(image_path), product_material_files(file_path)")
    .eq("id", id)
    .maybeSingle();
  const { dropReviewExtras, productReviewIds } = await import("@/core/reviews/photos.server");
  const reviewIds = await productReviewIds(ctx, id);
  const { error } = await ctx.db.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  // Отзывы товара ушли вместе с ним — их фото и решения продавца следом.
  await dropReviewExtras(ctx, reviewIds);
  // Файлы в общих бакетах — только под своим префиксом.
  const own = (k: string | null | undefined): k is string =>
    Boolean(k && isTenantStorageKey(ctx.tenant.id, k));
  const imgs = (p?.product_images ?? []).map((i) => i.image_path).filter(own);
  const lessons = await (await import("@/core/courses/course.server")).dropCourse(ctx, id);
  const files = [...(p?.product_material_files ?? []).map((f) => f.file_path), ...lessons].filter(
    own,
  );
  if (imgs.length) await serviceDb().storage.from("product-images").remove(imgs);
  if (files.length) await serviceDb().storage.from("product-files").remove(files);
}

export async function setProductActive(
  ctx: TenantContext,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await ctx.db.from("products").update({ is_active: active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Картинки товара заменяются списком целиком — порядок = порядок в списке. */
export async function setProductImages(
  ctx: TenantContext,
  productId: string,
  paths: string[],
): Promise<void> {
  const { data: had } = await ctx.db
    .from("product_images")
    .select("image_path")
    .eq("product_id", productId);
  const stored = new Set((had ?? []).map((r) => r.image_path));
  for (const p of paths)
    if (!isAdminInputStorageKey(ctx.tenant.id, p, stored))
      throw new Error("Ключ картинки вне префикса клиента.");
  await ctx.db.from("product_images").delete().eq("product_id", productId);
  if (paths.length) {
    const { error } = await ctx.db.from("product_images").insert(
      paths.map((image_path, i) => ({
        bot_id: ctx.tenant.id,
        product_id: productId,
        image_path,
        sort_order: i,
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export type MaterialInput = {
  language: "ru" | "kk" | "en" | "uz";
  filePath: string;
  fileName: string | null;
};

export async function setProductMaterials(
  ctx: TenantContext,
  productId: string,
  files: MaterialInput[],
): Promise<void> {
  const [{ data: had }, { data: legacy }] = await Promise.all([
    ctx.db.from("product_material_files").select("file_path").eq("product_id", productId),
    ctx.db.from("products").select("file_path, file_path_kz").eq("id", productId).maybeSingle(),
  ]);
  // Старый файл v1 из полей товара (editableMaterials) — тоже «уже записан у строки».
  const stored = new Set(
    [...(had ?? []).map((r) => r.file_path), legacy?.file_path, legacy?.file_path_kz].filter(
      (k): k is string => Boolean(k),
    ),
  );
  for (const f of files)
    if (!isAdminInputStorageKey(ctx.tenant.id, f.filePath, stored))
      throw new Error("Ключ файла вне префикса клиента.");
  await ctx.db.from("product_material_files").delete().eq("product_id", productId);
  if (files.length) {
    const { error } = await ctx.db.from("product_material_files").insert(
      files.map((f, i) => ({
        bot_id: ctx.tenant.id,
        product_id: productId,
        language: f.language,
        file_path: f.filePath,
        file_name: f.fileName,
        sort_order: i,
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export type VariantInput = { name: string; price: number };

export async function setProductVariants(
  ctx: TenantContext,
  productId: string,
  variants: VariantInput[],
): Promise<void> {
  await ctx.db.from("product_variants").delete().eq("product_id", productId);
  if (variants.length) {
    const { error } = await ctx.db.from("product_variants").insert(
      variants.map((v, i) => ({
        bot_id: ctx.tenant.id,
        product_id: productId,
        name: v.name.trim(),
        price: v.price,
        sort_order: i,
      })),
    );
    if (error) throw new Error(error.message);
  }
}
