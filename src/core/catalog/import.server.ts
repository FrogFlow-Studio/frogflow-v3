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
import { parseCatalogCsv, planImport, type ImportField, type ProductDraft } from "./import";

export type ImportPreview = {
  ok: boolean;
  fields: ImportField[];
  unknownColumns: string[];
  errors: Array<{ line: number; message: string }>;
  create: number;
  update: number;
  newCategories: string[];
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

export async function previewImport(ctx: TenantContext, csv: string): Promise<ImportPreview> {
  const parsed = parseCatalogCsv(csv);
  const { products, categories } = await catalogIndex(ctx);
  const plan = planImport(parsed.drafts, products);
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
    errors: parsed.errors,
    create: plan.create.length,
    update: plan.update.length,
    newCategories,
    samples,
  };
}

export type ProductPatch = Database["public"]["Tables"]["products"]["Update"];

/** Только присланные поля; имя — лишь при совпадении по id (по названию его не с чем сравнивать). */
export function patchOf(
  d: ProductDraft,
  by: "id" | "name",
  categoryId: string | null | undefined,
): ProductPatch {
  const patch: ProductPatch = {};
  if (by === "id" && d.name) patch.name = d.name;
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
  errors: string[];
};

export async function applyImport(
  ctx: TenantContext,
  csv: string,
  actor = "system",
): Promise<ImportResult> {
  const parsed = parseCatalogCsv(csv);
  const { products, categories } = await catalogIndex(ctx);
  const plan = planImport(parsed.drafts, products);
  const catByName = new Map(categories.map((c) => [catKey(c.name), c.id]));
  const result: ImportResult = {
    created: 0,
    updated: 0,
    categoriesCreated: 0,
    errors: parsed.errors.map((e) => `строка ${e.line}: ${e.message}`),
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

  for (const d of plan.create) {
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
    try {
      const categoryId = await categoryFor(d.category);
      const patch = patchOf(d, by, categoryId);
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
  return result;
}
