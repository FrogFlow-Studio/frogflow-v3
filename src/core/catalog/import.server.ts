/**
 * Применение импорта каталога: категории по названию (недостающие
 * создаются верхнего уровня), товары — по id или названию обновляются,
 * иначе создаются. Обновляются только те поля, что есть в файле:
 * выгрузил → поправил цены → загрузил обратно, ничего не потеряв.
 */
import type { Database } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { createCategory } from "./admin";
import { recordStockChange } from "./stock-history";
import {
  MAX_IMPORT_ROWS,
  parseCatalogCsv,
  planImport,
  type ImportField,
  type PlanMatch,
  type ProductDraft,
} from "./import";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import { storeImportPhoto } from "./import-photo.server";

export type ImportPreview = {
  ok: boolean;
  fields: ImportField[];
  unknownColumns: string[];
  errors: Array<{ line: number; message: string }>;
  /** Строка принята, но часть данных не взята (например, неверная ссылка на фото). */
  warnings: Array<{ line: number; message: string }>;
  create: number;
  update: number;
  newCategories: string[];
  /** Сколько товаров с фото по ссылкам: их скачает применение, это дольше обычного. */
  withPhotos: number;
  samples: Array<{
    action: "create" | "update";
    name: string;
    price: number | null;
    category: string | null;
  }>;
};

async function catalogIndex(ctx: TenantContext) {
  const products = await pageAll(
    (from, to) => ctx.db.from("products").select("id, name").order("id").range(from, to),
    "товары для импорта",
  );
  const categories = await pageAll(
    (from, to) => ctx.db.from("categories").select("id, name").order("id").range(from, to),
    "категории для импорта",
  );
  return { products, categories: categories ?? [] };
}

const catKey = (s: string) => s.trim().toLowerCase();

/** Артикулы, привязанные прошлыми импортами (bots.settings.catalog_skus). */
const skuMap = (ctx: TenantContext) =>
  new Map(Object.entries(ctx.tenant.settings.catalog_skus ?? {}));

/** Общий бюджет применения меньше лимита функции (120 с): таблица и фото. */
export const IMPORT_DB_BUDGET_MS = 80_000;
export const IMPORT_TOTAL_BUDGET_MS = 105_000;

/** maxRows — потолок строк за раз; таблица по ссылке (sheet.server) читается целиком. */
export async function previewImport(
  ctx: TenantContext,
  csv: string,
  maxRows = MAX_IMPORT_ROWS,
): Promise<ImportPreview> {
  const parsed = parseCatalogCsv(csv, { maxRows });
  const { products, categories } = await catalogIndex(ctx);
  const plan = planImport(parsed.drafts, products, skuMap(ctx));
  const known = new Set(categories.map((c) => catKey(c.name)));
  const newCategories = [
    ...new Set(
      parsed.drafts
        .map((d) => d.category)
        .filter((c): c is string => Boolean(c) && !known.has(catKey(c!))),
    ),
  ];
  const samples = [
    ...plan.create.map((d) => ({
      action: "create" as const,
      name: d.name,
      price: d.price,
      category: d.category,
    })),
    ...plan.update.map(({ draft: d }) => ({
      action: "update" as const,
      name: d.name,
      price: d.price,
      category: d.category,
    })),
  ].slice(0, 12);
  return {
    ok: parsed.drafts.length > 0,
    fields: parsed.fields,
    unknownColumns: parsed.unknownColumns,
    errors: [
      ...parsed.errors,
      ...plan.repeats.map((d) => ({
        line: d.line,
        message: `«${d.name}» уже обновляется другой строкой файла — повтор пропущен`,
      })),
    ],
    warnings: parsed.warnings,
    create: plan.create.length,
    update: plan.update.length,
    withPhotos: parsed.drafts.filter((d) => d.photos?.length).length,
    newCategories,
    samples,
  };
}

export type ProductPatch = Database["public"]["Tables"]["products"]["Update"];

/** Только присланные поля; имя — лишь при совпадении по id или артикулу (по названию его не с чем сравнивать). */
export function patchOf(
  d: ProductDraft,
  by: PlanMatch,
  categoryId: string | null | undefined,
): ProductPatch {
  const patch: ProductPatch = {};
  if (by !== "name" && d.name) patch.name = d.name;
  if (d.price !== null) patch.price = d.price;
  if (d.currency) patch.currency = d.currency;
  if (categoryId !== undefined) patch.category_ids = categoryId ? [categoryId] : [];
  if (d.description !== null) patch.description = d.description;
  if (d.keywords !== null) patch.keywords = d.keywords;
  if (d.active !== null) patch.is_active = d.active;
  if (d.stock !== undefined) patch.stock_quantity = d.stock;
  if (d.fileUrl !== null) patch.file_url = d.fileUrl;
  if (d.fileUrlKz !== null) patch.file_url_kz = d.fileUrlKz;
  if (d.sortOrder !== null) patch.sort_order = d.sortOrder;
  if (d.kind) patch.fulfillment_kind = d.kind;
  return patch;
}

export type ImportResult = {
  created: number;
  updated: number;
  categoriesCreated: number;
  /** Товаров, которым скачались фото. */
  photosAdded: number;
  errors: string[];
  warnings: string[];
};

export async function applyImport(
  ctx: TenantContext,
  csv: string,
  actor = "system",
): Promise<ImportResult> {
  const startedAt = Date.now();
  const parsed = parseCatalogCsv(csv, { maxRows: MAX_IMPORT_ROWS });
  const { products, categories } = await catalogIndex(ctx);
  const plan = planImport(parsed.drafts, products, skuMap(ctx));
  const catByName = new Map(categories.map((c) => [catKey(c.name), c.id]));
  const result: ImportResult = {
    created: 0,
    updated: 0,
    categoriesCreated: 0,
    photosAdded: 0,
    errors: [
      ...parsed.errors.map((e) => `строка ${e.line}: ${e.message}`),
      ...plan.repeats.map(
        (d) =>
          `строка ${d.line}: «${d.name}» уже обновляется другой строкой файла — повтор пропущен`,
      ),
    ],
    warnings: parsed.warnings.map((w) => `строка ${w.line}: ${w.message}`),
  };
  const categoryFor = async (name: string | null): Promise<string | null | undefined> => {
    if (name === null) return undefined; // колонки нет или пусто — не трогаем
    const key = catKey(name);
    let id = catByName.get(key);
    if (!id) {
      id = await createCategory(ctx, {
        name: name.trim(),
        parentId: null,
        sortOrder: categories.length + result.categoriesCreated,
      });
      catByName.set(key, id);
      result.categoriesCreated++;
    }
    return id;
  };
  const { getSetting } = await import("@/core/settings/settings");
  const currency = ((await getSetting(ctx, "currency")) ?? "KZT").toUpperCase();

  /** Артикулы, которые надо запомнить, и товары, которым надо докачать фото. */
  const newSkus: Record<string, string> = {};
  const wantPhotos: Array<{ id: string; draft: ProductDraft; isNew: boolean }> = [];
  const outOfTime = () => Date.now() - startedAt > IMPORT_DB_BUDGET_MS;
  let stoppedAt: number | null = null;

  for (const d of plan.create) {
    if (outOfTime()) {
      stoppedAt = d.line;
      break;
    }
    try {
      const categoryId = await categoryFor(d.category);
      const { data: created, error } = await ctx.db
        .from("products")
        .insert({
          bot_id: ctx.tenant.id,
          name: d.name,
          description: d.description ?? "",
          keywords: d.keywords ?? "",
          price: d.price ?? 0,
          currency: d.currency ?? currency,
          country_prices: {},
          category_ids: categoryId ? [categoryId] : [],
          is_active: d.active ?? true,
          sort_order: d.sortOrder ?? 0,
          fulfillment_kind: d.kind ?? "digital",
          stock_quantity: d.stock ?? null,
          file_url: d.fileUrl,
          file_url_kz: d.fileUrlKz,
        })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "insert failed");
      if (d.sku) newSkus[d.sku] = created.id;
      if (d.photos?.length) wantPhotos.push({ id: created.id, draft: d, isNew: true });
      if (d.stock != null)
        await recordStockChange(
          ctx,
          { productId: created.id, from: null, to: d.stock },
          { reason: "import", actor },
        );
      result.created++;
    } catch (e) {
      result.errors.push(
        `строка ${d.line} («${d.name}»): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  for (const { id, by, draft: d } of plan.update) {
    if (stoppedAt === null && outOfTime()) stoppedAt = d.line;
    if (stoppedAt !== null) break;
    try {
      const categoryId = await categoryFor(d.category);
      const patch = patchOf(d, by, categoryId);
      if (d.sku) newSkus[d.sku] = id;
      if (d.photos?.length) wantPhotos.push({ id, draft: d, isNew: false });
      if (Object.keys(patch).length === 0) continue;
      // Остаток «до» — для истории; не прочитался, не пишем вслепую.
      let stockBefore: number | null | undefined;
      if (patch.stock_quantity !== undefined) {
        const { data: cur, error: curError } = await ctx.db
          .from("products")
          .select("stock_quantity")
          .eq("id", id)
          .maybeSingle();
        if (curError) throw serverFailure(`Импорт: ${curError.message}`);
        stockBefore = cur ? cur.stock_quantity : undefined;
      }
      const { error } = await ctx.db.from("products").update(patch).eq("id", id);
      if (error) throw serverFailure(error.message);
      if (stockBefore !== undefined && patch.stock_quantity !== undefined)
        await recordStockChange(
          ctx,
          { productId: id, from: stockBefore, to: patch.stock_quantity },
          { reason: "import", actor },
        );
      result.updated++;
    } catch (e) {
      result.errors.push(
        `строка ${d.line} («${d.name}»): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (stoppedAt !== null)
    result.errors.push(
      `Время вышло на строке ${stoppedAt}: остальные не обработаны. Загрузите файл ещё раз — готовые товары найдутся по артикулу или названию и не задвоятся`,
    );

  // Артикулы запоминаем сразу после таблицы: даже если фото не успеют, повтор найдёт товары.
  if (Object.keys(newSkus).length) {
    try {
      await patchTenantSettings(ctx.tenant.id, { catalog_skus: newSkus });
    } catch (e) {
      result.errors.push(
        `Артикулы не сохранились (${e instanceof Error ? e.message : String(e)}): повторная загрузка найдёт товары по названию`,
      );
    }
  }
  await addPhotos(ctx, wantPhotos, result, startedAt);
  return result;
}

const PHOTO_PARALLEL = 4;

/**
 * Фото по ссылкам. Новому товару — все; существующему — только если у него
 * ещё нет картинок (повторная загрузка не задваивает фото, а дозагружает
 * недостающее). Не успели в бюджет — товар остаётся как есть, это видно в ответе.
 */
async function addPhotos(
  ctx: TenantContext,
  list: Array<{ id: string; draft: ProductDraft; isNew: boolean }>,
  result: ImportResult,
  startedAt: number,
): Promise<void> {
  if (list.length === 0) return;
  const { setProductImages } = await import("./admin");
  const left = () => IMPORT_TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let skippedForTime = 0;
  const one = async (item: (typeof list)[number]) => {
    if (left() < 5_000) {
      skippedForTime++;
      return;
    }
    const { id, draft: d } = item;
    if (!item.isNew) {
      const { count, error } = await ctx.db
        .from("product_images")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id);
      if (error) {
        result.errors.push(
          `строка ${d.line} («${d.name}»): фото не добавлены, не прочиталась галерея`,
        );
        return;
      }
      if ((count ?? 0) > 0) return; // фото уже есть — не трогаем
    }
    const keys: string[] = [];
    for (const url of d.photos ?? []) {
      if (left() < 5_000) {
        skippedForTime++;
        break;
      }
      const r = await storeImportPhoto(ctx, url, Math.min(15_000, left()));
      if (r.ok) keys.push(r.key);
      else
        result.warnings.push(
          `строка ${d.line} («${d.name}»): фото ${url.slice(0, 60)} — ${r.reason}`,
        );
    }
    if (keys.length === 0) return;
    try {
      await setProductImages(ctx, id, keys);
      result.photosAdded++;
    } catch (e) {
      result.errors.push(
        `строка ${d.line} («${d.name}»): фото скачались, но не сохранились (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  };
  for (let i = 0; i < list.length; i += PHOTO_PARALLEL)
    await Promise.all(list.slice(i, i + PHOTO_PARALLEL).map(one));
  if (skippedForTime > 0)
    result.errors.push(
      `Фото не успели скачаться у ${skippedForTime} товаров: загрузите файл ещё раз — товары найдутся, недостающие фото докачаются`,
    );
}
