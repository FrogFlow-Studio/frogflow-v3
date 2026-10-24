import { pageAll } from "@/core/db/page";
import { chunksOf } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import { isAdminInputStorageKey, isTenantStorageKey } from "@/core/storage/keys";
import { PRODUCT_SELECT, type Product } from "./catalog";
import {
  MATERIAL_COLUMNS,
  materialCount,
  materialLanguages,
  materialsForProduct,
  type ProductWithFiles,
} from "./materials";
import type { VariantMaterialsMap } from "./variant-materials";
import type { Locale } from "@/core/i18n/locale";
import { pickerTerm } from "./picker";
import { toJson } from "@/core/json";
import { isCourseProduct } from "@/core/courses/marker";
import { TOPIC_MARK } from "./topics";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];

/* ── категории ────────────────────────────────────────────────────── */

export async function listAllCategories(ctx: TenantContext): Promise<CategoryRow[]> {
  const { data, error } = await ctx.db
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw serverFailure(error.message);
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
  if (error) throw serverFailure(error.message);
}

export async function deleteCategory(ctx: TenantContext, id: string): Promise<void> {
  const { count, error: countError } = await ctx.db
    .from("products")
    .select("id", { count: "exact", head: true })
    .contains("category_ids", JSON.stringify([id]));
  if (countError) throw serverFailure(`Каталог: ${countError.message}`);
  if (count)
    throw new UserError(
      "err.catalog.hasProducts",
      "В категории {count} товаров — сначала перенесите их.",
      { count },
    );
  const { count: kids, error: kidsError } = await ctx.db
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  if (kidsError) throw serverFailure(`Каталог: ${kidsError.message}`);
  if (kids)
    throw new UserError(
      "err.catalog.hasSubcategories",
      "У категории есть подкатегории — сначала удалите их.",
    );
  const { error } = await ctx.db.from("categories").delete().eq("id", id);
  if (error) throw serverFailure(error.message);
}

/* ── товары ───────────────────────────────────────────────────────── */

export type ProductListRow = {
  id: string;
  name: string;
  price: number;
  currency: string;
  country_prices: Record<string, number> | null;
  is_active: boolean;
  sort_order: number;
  fulfillment_kind: string;
  stock_quantity: number | null;
  category_ids: Json;
  created_at: string;
  images: number;
  files: number;
  /** Языки, на которых у товара есть файлы (как при выдаче, со старыми полями v1). */
  langs: Locale[];
  variants: number;
  cover: string | null;
  /** Для «Готовности» в списке: текст описания не отдаём, только есть он или нет. */
  has_description: boolean;
  is_course: boolean;
};

/** Строк на странице списка товаров; следующая — кнопкой «Показать ещё». */
export const PRODUCT_PAGE = 100;

/** Порядок списка товаров в админке. «catalog» — как в каталоге (перетаскиванием). */
export const PRODUCT_SORTS = ["catalog", "new", "old", "name", "price"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Фильтр «Язык материалов»: есть / нет файлов на этом языке. */
export type ProductLangFilter = { lang: Locale; has: boolean };

export type ProductListOpts = {
  q?: string;
  categoryId?: string | null;
  onlyInactive?: boolean;
  sort?: ProductSort;
  lang?: ProductLangFilter | null;
  /** Только товары без темы для «Похожих» (core/catalog/topics) — что ещё не размечено. */
  noTopic?: boolean;
  offset?: number;
};

type Filterable<Q> = {
  or(filters: string): Q;
  contains(column: "category_ids", value: string): Q;
  eq(column: "is_active", value: boolean): Q;
  not(column: "keywords", operator: "ilike", value: string): Q;
};

type Orderable<Q> = { order(column: string, o?: { ascending?: boolean }): Q };

/**
 * Фильтр списка товаров (поиск, категория, «только скрытые») — один для
 * страницы и для «выбрать все по фильтру». Поиск — по названию и ключевым
 * словам: код материала продавцы часто пишут в ключевые слова.
 */
function productFilter(opts: ProductListOpts) {
  return <Q extends Filterable<Q>>(q: Q): Q => {
    let r = q;
    const term = pickerTerm(opts.q ?? "");
    if (term) r = r.or(`name.ilike.%${term}%,keywords.ilike.%${term}%`);
    if (opts.categoryId) r = r.contains("category_ids", JSON.stringify([opts.categoryId]));
    if (opts.onlyInactive) r = r.eq("is_active", false);
    if (opts.noTopic) r = r.not("keywords", "ilike", `%${TOPIC_MARK}%`);
    return r;
  };
}

/** Порядок списка; в хвосте всегда id — иначе равные строки переезжают между страницами. */
function productOrder(sort: ProductSort | undefined) {
  return <Q extends Orderable<Q>>(q: Q): Q => {
    switch (sort) {
      case "new":
        return q.order("created_at", { ascending: false }).order("id", { ascending: false });
      case "old":
        return q.order("created_at").order("id");
      case "name":
        return q.order("name").order("id");
      case "price":
        return q.order("price").order("name").order("id");
      default:
        return q.order("sort_order").order("name").order("id");
    }
  };
}

/**
 * Подходит ли товар под фильтр «Язык материалов». Файлы считаются так же,
 * как при выдаче (`materialsForProduct`): товар v1 с казахским файлом в
 * старом поле file_path_kz — «есть на KZ». «Нет на языке» — список того, что
 * надо перевести, поэтому физические товары и курсы (им нечего переводить
 * файлом) в него не попадают.
 */
export function matchesLangFilter(p: ProductWithFiles, f: ProductLangFilter): boolean {
  const has = materialsForProduct(p, f.lang).length > 0;
  if (f.has) return has;
  if (p.fulfillment_kind === "physical" || isCourseProduct(p)) return false;
  return !has;
}

/**
 * id товаров под фильтром языка в порядке списка. Язык считается по файлам
 * (новая таблица и старые поля v1), в запросе это не выразить — читаем весь
 * отфильтрованный каталог постранично (без обрезки) и отбираем здесь.
 */
async function idsByLang(
  ctx: TenantContext,
  opts: Omit<ProductListOpts, "offset">,
  f: ProductLangFilter,
): Promise<string[]> {
  const filtered = productFilter(opts);
  const ordered = productOrder(opts.sort);
  const rows = await pageAll(
    (from, to) =>
      ordered(
        filtered(
          ctx.db
            .from("products")
            .select(`id, name, price, sort_order, created_at, ${MATERIAL_COLUMNS}`),
        ),
      ).range(from, to),
    "Товары по языку",
  );
  return rows.filter((p) => matchesLangFilter(p as ProductWithFiles, f)).map((p) => p.id);
}

/** Все id товаров по фильтру списка, постранично и без обрезки (порядок — по id). */
export async function listProductIdsForAdmin(
  ctx: TenantContext,
  opts: Omit<ProductListOpts, "offset"> = {},
): Promise<string[]> {
  if (opts.lang) return (await idsByLang(ctx, opts, opts.lang)).sort();
  const filtered = productFilter(opts);
  const rows = await pageAll(
    (from, to) => filtered(ctx.db.from("products").select("id")).order("id").range(from, to),
    "Товары по фильтру",
  );
  return rows.map((r) => r.id);
}

const LIST_SELECT =
  "id, name, description, price, currency, country_prices, is_active, sort_order, fulfillment_kind, stock_quantity, category_ids, created_at, file_path, file_url, file_path_kz, file_url_kz, product_images(image_path, sort_order), product_material_files(language, file_path), product_variants(id, name)";

/**
 * Страница списка товаров. Порядок — выбранный (`sort`), в конце всегда id:
 * без уникального ключа в хвосте товары с одинаковыми позицией и
 * названием могли переезжать между страницами (повтор или пропуск).
 * С фильтром языка страница режется из полного списка подходящих id.
 */
export async function listProductsForAdmin(
  ctx: TenantContext,
  opts: ProductListOpts = {},
): Promise<{ rows: ProductListRow[]; total: number; hasMore: boolean }> {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const filtered = productFilter(opts);
  const ordered = productOrder(opts.sort);
  let data: ProductListSource[];
  let total: number;
  if (opts.lang) {
    const ids = await idsByLang(ctx, opts, opts.lang);
    const pageIds = ids.slice(offset, offset + PRODUCT_PAGE);
    const pos = new Map(pageIds.map((id, i) => [id, i]));
    const page = pageIds.length
      ? // Не больше страницы списка (100) — короче лимита в 200.
        await ctx.db
          .from("products")
          .select(LIST_SELECT)
          .in("id", ids.slice(offset, offset + PRODUCT_PAGE))
      : { data: [], error: null };
    if (page.error) throw serverFailure(page.error.message);
    data = ((page.data ?? []) as ProductListSource[])
      .slice()
      .sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    total = ids.length;
  } else {
    const [page, count] = await Promise.all([
      ordered(filtered(ctx.db.from("products").select(LIST_SELECT))).range(
        offset,
        offset + PRODUCT_PAGE - 1,
      ),
      filtered(ctx.db.from("products").select("id", { count: "exact", head: true })),
    ]);
    if (page.error) throw serverFailure(page.error.message);
    if (count.error) throw serverFailure(count.error.message);
    data = (page.data ?? []) as ProductListSource[];
    total = count.count ?? offset + data.length;
  }
  const pidsWithVariants = data
    .filter((p) => (p.product_variants?.length ?? 0) > 0 && p.fulfillment_kind === "digital")
    .map((p) => p.id);
  const vmMap =
    pidsWithVariants.length > 0
      ? await (
          await import("./variant-materials")
        ).loadVariantMaterialsForProducts(ctx, pidsWithVariants)
      : new Map<string, VariantMaterialsMap>();

  const rows = data.map((p) => {
    const vm = vmMap.get(p.id);
    const enrichedVariants = vm
      ? (p.product_variants ?? []).map((v) => ({
          ...v,
          file_path: vm[v.id]?.filePath ?? (v.name ? vm[v.name.trim()]?.filePath : null) ?? null,
          file_name: vm[v.id]?.fileName ?? (v.name ? vm[v.name.trim()]?.fileName : null) ?? null,
        }))
      : (p.product_variants ?? []);
    const productForMaterials = {
      ...p,
      product_variants: enrichedVariants,
    };
    return {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      currency: p.currency,
      country_prices:
        p.country_prices && typeof p.country_prices === "object" && !Array.isArray(p.country_prices)
          ? (p.country_prices as Record<string, number>)
          : null,
      is_active: p.is_active,
      sort_order: p.sort_order,
      fulfillment_kind: p.fulfillment_kind,
      stock_quantity: p.stock_quantity,
      category_ids: p.category_ids,
      created_at: p.created_at,
      images: p.product_images?.length ?? 0,
      // Товар v1 с файлом в старых полях или файлами в вариантах — не «нет файла».
      files: materialCount(productForMaterials),
      langs: materialLanguages(productForMaterials),
      variants: p.product_variants?.length ?? 0,
      has_description: Boolean(p.description?.trim()),
      is_course: isCourseProduct(p),
      cover:
        p.product_images?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.image_path ??
        null,
    };
  });
  return { rows, total, hasMore: offset + rows.length < total };
}

type ProductListSource = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  currency: string;
  country_prices: Json;
  is_active: boolean;
  sort_order: number;
  fulfillment_kind: string;
  stock_quantity: number | null;
  category_ids: Json;
  created_at: string;
  file_path: string | null;
  file_url: string | null;
  file_path_kz: string | null;
  file_url_kz: string | null;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
  product_material_files: Array<{ language: string | null; file_path: string | null }> | null;
  product_variants: Array<{ id: string; name?: string | null }> | null;
};

export async function getProductForAdmin(ctx: TenantContext, id: string): Promise<Product | null> {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (dataError) throw serverFailure(`Каталог: ${dataError.message}`);
  if (!data) return null;
  const prod = data as Product;
  if (prod.product_variants?.length) {
    const { getVariantMaterials, resolveVariantMaterial } = await import("./variant-materials");
    const vm = await getVariantMaterials(ctx, id);
    if (Object.keys(vm).length > 0) {
      prod.product_variants = prod.product_variants.map((v) => {
        const mat = resolveVariantMaterial(vm, v.id, v.name);
        return mat ? { ...v, file_path: mat.filePath, file_name: mat.fileName } : v;
      });
    }
  }
  return prod;
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
    category_ids: toJson(i.categoryIds),
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
  if (error || !data) throw serverFailure(`Каталог: ${error?.message ?? "товар не создан"}`);
  return data.id;
}

export async function updateProduct(
  ctx: TenantContext,
  id: string,
  input: ProductInput,
): Promise<void> {
  const { bot_id: _b, ...patch } = toRow(ctx, input);
  const { error } = await ctx.db.from("products").update(patch).eq("id", id);
  if (error) throw serverFailure(`Каталог: ${error.message}`);
}

export async function deleteProduct(ctx: TenantContext, id: string): Promise<void> {
  const { data: p, error: pError } = await ctx.db
    .from("products")
    .select("product_images(image_path), product_material_files(file_path)")
    .eq("id", id)
    .maybeSingle();
  if (pError) throw serverFailure(`Каталог: ${pError.message}`);
  const { dropReviewExtras, productReviewIds } = await import("@/core/reviews/photos.server");
  const reviewIds = await productReviewIds(ctx, id);
  const { error } = await ctx.db.from("products").delete().eq("id", id);
  if (error) throw serverFailure(error.message);
  // Отзывы товара ушли вместе с ним — их фото и решения продавца следом.
  await dropReviewExtras(ctx, reviewIds);
  // Себестоимость товара лежит отдельной записью — без товара она никому не нужна.
  // Снимки в заказах не трогаем: это история. Сбой чистки не ломает удаление.
  const { error: costError } = await ctx.db
    .from("app_settings")
    .delete()
    .eq("bot_id", ctx.tenant.id)
    .eq("key", `cost:${id}`);
  if (costError)
    console.error(`[catalog] себестоимость товара ${id} не удалена`, costError.message);
  // Состав набора (если товар был набором) — тоже отдельная запись.
  await (await import("@/core/bundles/bundle")).dropBundle(ctx, id);
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
  if (error) throw serverFailure(error.message);
}

/** Картинки товара заменяются списком целиком — порядок = порядок в списке. */
export async function setProductImages(
  ctx: TenantContext,
  productId: string,
  paths: string[],
): Promise<void> {
  const { data: had, error: hadError } = await ctx.db
    .from("product_images")
    .select("image_path")
    .eq("product_id", productId);
  if (hadError) throw serverFailure(`Каталог: ${hadError.message}`);
  const stored = new Set((had ?? []).map((r) => r.image_path));
  for (const p of paths)
    if (!isAdminInputStorageKey(ctx.tenant.id, p, stored))
      throw new Error("Ключ картинки вне префикса клиента.");
  const cleared = await ctx.db.from("product_images").delete().eq("product_id", productId);
  if (cleared.error) throw serverFailure(`Каталог: ${cleared.error.message}`);
  if (paths.length) {
    const { error } = await ctx.db.from("product_images").insert(
      paths.map((image_path, i) => ({
        bot_id: ctx.tenant.id,
        product_id: productId,
        image_path,
        sort_order: i,
      })),
    );
    if (error) throw serverFailure(error.message);
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
  const [{ data: had, error: hadError }, { data: legacy, error: legacyError }] = await Promise.all([
    ctx.db.from("product_material_files").select("file_path").eq("product_id", productId),
    ctx.db.from("products").select("file_path, file_path_kz").eq("id", productId).maybeSingle(),
  ]);
  if (hadError) throw serverFailure(`Каталог: ${hadError.message}`);
  if (legacyError) throw serverFailure(`Каталог: ${legacyError.message}`);
  // Старый файл v1 из полей товара (editableMaterials) — тоже «уже записан у строки».
  const stored = new Set(
    [...(had ?? []).map((r) => r.file_path), legacy?.file_path, legacy?.file_path_kz].filter(
      (k): k is string => Boolean(k),
    ),
  );
  for (const f of files)
    if (!isAdminInputStorageKey(ctx.tenant.id, f.filePath, stored))
      throw new Error("Ключ файла вне префикса клиента.");
  const cleared = await ctx.db.from("product_material_files").delete().eq("product_id", productId);
  if (cleared.error) throw serverFailure(`Каталог: ${cleared.error.message}`);
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
    if (error) throw serverFailure(error.message);
  }
}

export type VariantInput = {
  name: string;
  price: number;
  filePath?: string | null;
  fileName?: string | null;
};

export async function setProductVariants(
  ctx: TenantContext,
  productId: string,
  variants: VariantInput[],
): Promise<void> {
  // Варианты не пересоздаём: на их id ссылаются корзины и позиции неоплаченных
  // заказов (ON DELETE SET NULL), и пересохранение карточки стирало бы выбор
  // покупателя. Совпадение — по названию; новые добавляем, убранные удаляем.
  const { data: existing, error: readError } = await ctx.db
    .from("product_variants")
    .select("id, name")
    .eq("product_id", productId)
    .order("sort_order")
    .order("id");
  if (readError) throw serverFailure(`Каталог: ${readError.message}`);
  const free = new Map<string, string[]>();
  for (const row of (existing ?? []) as { id: string; name: string }[]) {
    const key = row.name.trim();
    free.set(key, [...(free.get(key) ?? []), row.id]);
  }
  const fresh: {
    id: string;
    bot_id: string;
    product_id: string;
    name: string;
    price: number;
    sort_order: number;
  }[] = [];
  const kept: { id: string; v: VariantInput; sort: number }[] = [];
  const variantFileMap: Record<string, { filePath: string; fileName: string | null }> = {};

  variants.forEach((v, i) => {
    const trimmed = v.name.trim();
    const id = free.get(trimmed)?.shift() ?? crypto.randomUUID();
    const hasKeptId = (existing ?? []).some((r) => r.id === id);
    if (hasKeptId) {
      kept.push({ id, v, sort: i });
    } else {
      fresh.push({
        id,
        bot_id: ctx.tenant.id,
        product_id: productId,
        name: trimmed,
        price: v.price,
        sort_order: i,
      });
    }
    if (v.filePath?.trim()) {
      variantFileMap[id] = { filePath: v.filePath.trim(), fileName: v.fileName?.trim() || null };
      variantFileMap[trimmed] = {
        filePath: v.filePath.trim(),
        fileName: v.fileName?.trim() || null,
      };
    }
  });
  if (fresh.length) {
    const { error } = await ctx.db.from("product_variants").insert(fresh);
    if (error) throw serverFailure(`Каталог: ${error.message}`);
  }
  for (const k of kept) {
    const { error } = await ctx.db
      .from("product_variants")
      .update({ price: k.v.price, sort_order: k.sort, name: k.v.name.trim() })
      .eq("id", k.id);
    if (error) throw serverFailure(`Каталог: ${error.message}`);
  }
  const gone = [...free.values()].flat();
  for (const chunk of chunksOf(gone)) {
    const { error } = await ctx.db.from("product_variants").delete().in("id", chunk);
    if (error) throw serverFailure(`Каталог: ${error.message}`);
  }

  // Сохраняем привязку файлов к вариантам цифрового товара
  const { saveVariantMaterials } = await import("./variant-materials");
  await saveVariantMaterials(ctx, productId, variantFileMap);
}
