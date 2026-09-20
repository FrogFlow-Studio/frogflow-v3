import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import { PRODUCT_SELECT, type Product } from "./catalog";

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
  if (input.parentId === id) throw new Error("Категория не может быть родителем самой себе.");
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
  if (count) throw new Error(`В категории ${count} товаров — сначала перенесите их.`);
  const { count: kids } = await ctx.db
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  if (kids) throw new Error("У категории есть подкатегории — сначала удалите их.");
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

export async function listProductsForAdmin(
  ctx: TenantContext,
  opts: { q?: string; categoryId?: string | null; onlyInactive?: boolean } = {},
): Promise<ProductListRow[]> {
  let q = ctx.db
    .from("products")
    .select(
      "id, name, price, currency, is_active, sort_order, fulfillment_kind, stock_quantity, category_ids, created_at, product_images(image_path, sort_order), product_material_files(id), product_variants(id)",
    )
    .order("sort_order")
    .order("name");
  if (opts.q?.trim()) q = q.ilike("name", `%${opts.q.trim().replace(/[%_]/g, " ")}%`);
  if (opts.categoryId) q = q.contains("category_ids", JSON.stringify([opts.categoryId]));
  if (opts.onlyInactive) q = q.eq("is_active", false);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
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
    files: p.product_material_files?.length ?? 0,
    variants: p.product_variants?.length ?? 0,
    cover:
      p.product_images?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.image_path ?? null,
  }));
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
  const { error } = await ctx.db.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  // Файлы в общих бакетах — только под своим префиксом.
  const own = (k: string | null | undefined): k is string =>
    Boolean(k && k.startsWith(`${ctx.tenant.id}/`));
  const imgs = (p?.product_images ?? []).map((i) => i.image_path).filter(own);
  const files = (p?.product_material_files ?? []).map((f) => f.file_path).filter(own);
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
  for (const p of paths)
    if (!p.startsWith(`${ctx.tenant.id}/`)) throw new Error("Ключ картинки вне префикса клиента.");
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
  for (const f of files)
    if (!f.filePath.startsWith(`${ctx.tenant.id}/`))
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
