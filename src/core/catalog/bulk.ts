import { serverFailure } from "@/lib/server-failure";
import { chunksOf, inChunks } from "@/lib/in-chunks";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";

/**
 * Массовые действия над выбранными товарами списка админки. Запись — по
 * каждому товару и только в нужное поле (скрытие — is_active, категория —
 * category_ids, цена — price, country_prices и цены вариантов): чужие поля
 * карточки, которые продавец правит параллельно, не затираются. Цена пишется
 * с условием «цена та же, что мы читали»: если её успели поменять, товар
 * пропускается с причиной, а не перезаписывается. Чтение — до любой записи,
 * ошибка чтения не меняет ничего.
 *
 * Архива товара в схеме нет (она не меняется), поэтому «в архив» — это
 * «скрыть с витрины»: карточка, файлы и заказы остаются.
 */
export const BULK_MAX = 500;
export const BULK_PERCENT_MIN = -90;
export const BULK_PERCENT_MAX = 500;
export const BULK_STOCK_MAX = 1_000_000;

export type BulkAction =
  | { kind: "active"; active: boolean }
  | { kind: "category"; categoryId: string | null; mode: "add" | "set" }
  | { kind: "price"; percent: number }
  /** Остаток (модуль «Склад»): задать число или прибавить к текущему. */
  | { kind: "stock"; mode: "set" | "add"; amount: number };

/** Причина, по которой товар пропущен (переводится в админке). */
export type SkipReason =
  "notFound" | "same" | "tooLow" | "changed" | "failed" | "digital" | "untracked" | "stockChanged";

export type BulkResult = {
  changed: string[];
  skipped: Array<{ id: string; name: string; reason: SkipReason }>;
  /** Отчёт по остаткам: было → стало (только для действия «остаток»). */
  stock: Array<{ id: string; name: string; from: number | null; to: number }>;
};

type Row = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  fulfillment_kind?: string | null;
  stock_quantity: number | null;
  category_ids: Json;
  country_prices: Json;
};

/** Цена после ±%: до целого, как цены на витрине (core/pricing). */
export function scalePrice(price: number, percent: number): number {
  return Math.round(price * (1 + percent / 100));
}

/** Карта цен по странам: каждая цена ±%; цена, ставшая меньше 1, остаётся прежней. */
export function scaleCountryPrices(table: Json, percent: number): Json {
  if (!table || typeof table !== "object" || Array.isArray(table)) return table;
  const out: Record<string, Json> = {};
  for (const [code, entry] of Object.entries(table as Record<string, Json>)) {
    const scale = (v: number) => {
      const next = scalePrice(v, percent);
      return next >= 1 ? next : v;
    };
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, Json>;
      const amount = Number(e.price);
      out[code] = Number.isFinite(amount) && amount > 0 ? { ...e, price: scale(amount) } : e;
    } else {
      const plain = Number(entry);
      out[code] = Number.isFinite(plain) && plain > 0 ? scale(plain) : entry;
    }
  }
  return out;
}

async function readProducts(ctx: TenantContext, ids: string[]): Promise<Map<string, Row>> {
  const data = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("products")
        .select(
          "id, name, price, is_active, fulfillment_kind, stock_quantity, category_ids, country_prices",
        )
        .in("id", chunk)
        .order("id"),
    "Массовые действия",
  );
  return new Map(data.map((r): [string, Row] => [r.id, { ...r, price: Number(r.price) }]));
}

async function readVariants(ctx: TenantContext, ids: string[]) {
  const byProduct = new Map<string, Array<{ id: string; price: number }>>();
  for (const chunk of chunksOf(ids)) {
    const rows = await pageAll(
      (from, to) =>
        ctx.db
          .from("product_variants")
          .select("id, product_id, price")
          .in("product_id", chunk)
          .order("id")
          .range(from, to),
      "варианты для массового действия",
    );
    for (const v of rows) {
      const list = byProduct.get(v.product_id) ?? [];
      list.push({ id: v.id, price: Number(v.price) });
      byProduct.set(v.product_id, list);
    }
  }
  return byProduct;
}

async function categoryExists(ctx: TenantContext, id: string): Promise<boolean> {
  const { data, error } = await ctx.db.from("categories").select("id").eq("id", id).maybeSingle();
  if (error) throw serverFailure(`Массовые действия: ${error.message}`);
  return Boolean(data);
}

export async function bulkUpdateProducts(
  ctx: TenantContext,
  rawIds: readonly string[],
  action: BulkAction,
): Promise<BulkResult & { before: Map<string, Row> }> {
  const ids = [...new Set(rawIds)];
  const result: BulkResult = { changed: [], skipped: [], stock: [] };
  const empty = { ...result, before: new Map<string, Row>() };
  if (ids.length === 0) return empty;
  if (ids.length > BULK_MAX)
    throw new UserError("err.catalog.bulkTooMany", "Выберите не больше {max} товаров за раз.", {
      max: BULK_MAX,
    });
  if (
    action.kind === "price" &&
    !(action.percent >= BULK_PERCENT_MIN && action.percent <= BULK_PERCENT_MAX)
  )
    throw new UserError("err.catalog.bulkPercent", "Изменение цены — от {min}% до {max}%.", {
      min: BULK_PERCENT_MIN,
      max: BULK_PERCENT_MAX,
    });
  if (action.kind === "stock") {
    if (!ctx.tenant.modules.stock)
      throw new UserError(
        "err.catalog.bulkNoStock",
        "Остатки доступны в модуле «Склад» — подключите его в «Модулях».",
      );
    const min = action.mode === "add" ? 1 : 0;
    if (!Number.isInteger(action.amount) || action.amount < min || action.amount > BULK_STOCK_MAX)
      throw new UserError(
        "err.catalog.bulkStockAmount",
        "Остаток — целое число от {min} до {max}.",
        { min, max: BULK_STOCK_MAX },
      );
  }
  if (
    action.kind === "category" &&
    action.categoryId &&
    !(await categoryExists(ctx, action.categoryId))
  )
    throw new UserError("err.catalog.bulkNoCategory", "Категория не найдена.");

  // Всё чтение — до первой записи: сбой чтения не оставит половину применённой.
  const rows = await readProducts(ctx, ids);
  const variants = action.kind === "price" ? await readVariants(ctx, [...rows.keys()]) : null;

  const skip = (id: string, name: string, reason: SkipReason) =>
    result.skipped.push({ id, name, reason });
  for (const id of ids) {
    const p = rows.get(id);
    if (!p) {
      skip(id, "", "notFound");
      continue;
    }
    try {
      const reason = await applyOne(ctx, p, action, variants?.get(id) ?? [], result);
      if (reason) skip(id, p.name, reason);
      else result.changed.push(id);
    } catch {
      skip(id, p.name, "failed");
    }
  }
  return { ...result, before: rows };
}

/** Одна запись; `null` — изменено, иначе причина пропуска. */
async function applyOne(
  ctx: TenantContext,
  p: Row,
  action: BulkAction,
  variants: Array<{ id: string; price: number }>,
  result: BulkResult,
): Promise<SkipReason | null> {
  if (action.kind === "stock") return applyStock(ctx, p, action, result);
  if (action.kind === "active") {
    if (p.is_active === action.active) return "same";
    const { error } = await ctx.db
      .from("products")
      .update({ is_active: action.active })
      .eq("id", p.id);
    return error ? "failed" : null;
  }
  if (action.kind === "category") {
    const have = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
    const next =
      action.mode === "add"
        ? action.categoryId
          ? have.includes(action.categoryId)
            ? have
            : [...have, action.categoryId]
          : have
        : action.categoryId
          ? [action.categoryId]
          : [];
    if (next.length === have.length && next.every((c, i) => c === have[i])) return "same";
    const { error } = await ctx.db
      .from("products")
      .update({ category_ids: next as unknown as Json })
      .eq("id", p.id);
    return error ? "failed" : null;
  }
  const price = scalePrice(p.price, action.percent);
  if (price === p.price) return "same";
  if (price < 1) return "tooLow";
  const { data, error } = await ctx.db
    .from("products")
    .update({
      price,
      country_prices: scaleCountryPrices(p.country_prices, action.percent),
    })
    .eq("id", p.id)
    .eq("price", p.price)
    .select("id");
  if (error) return "failed";
  if (!data || data.length === 0) return "changed";
  for (const v of variants) {
    const vp = scalePrice(v.price, action.percent);
    if (vp === v.price || vp < 1) continue;
    const { error } = await ctx.db
      .from("product_variants")
      .update({ price: vp })
      .eq("id", v.id)
      .eq("price", v.price);
    if (error) return "failed";
  }
  return null;
}

/**
 * Остаток: запись с условием «остаток тот же, что мы читали» — пока шёл выбор,
 * заказ мог его списать; тогда товар пропускается, а не перезаписывается.
 * «Прибавить» к неведомому остатку (null) смысла не имеет — пропуск. Пополнение
 * выше порога снимает отметку «заканчивается» (resetLowStock).
 */
async function applyStock(
  ctx: TenantContext,
  p: Row,
  action: Extract<BulkAction, { kind: "stock" }>,
  result: BulkResult,
): Promise<SkipReason | null> {
  if (p.fulfillment_kind === "digital") return "digital";
  if (action.mode === "add" && p.stock_quantity === null) return "untracked";
  const next = action.mode === "add" ? (p.stock_quantity ?? 0) + action.amount : action.amount;
  if (next === p.stock_quantity) return "same";
  const q = ctx.db.from("products").update({ stock_quantity: next }).eq("id", p.id);
  const { data, error } = await (
    p.stock_quantity === null
      ? q.is("stock_quantity", null)
      : q.eq("stock_quantity", p.stock_quantity)
  ).select("id");
  if (error) return "failed";
  if (!data || data.length === 0) return "stockChanged";
  result.stock.push({ id: p.id, name: p.name, from: p.stock_quantity, to: next });
  if (p.stock_quantity === null || next > p.stock_quantity) {
    // Остаток уже записан: сбой снятия отметки не отменяет пополнение (следующая проверка её снимет).
    const { resetLowStock } = await import("./low-stock");
    await resetLowStock(ctx, p.id).catch((e) =>
      console.error(`[bulk] отметка «заканчивается» не снята: ${String(e)}`),
    );
  }
  return null;
}
