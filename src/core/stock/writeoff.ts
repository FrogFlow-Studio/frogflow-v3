import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { recordStockChange, STOCK_EVENT_PREFIX } from "@/core/catalog/stock-history";
import { loadCost, unitCost } from "@/core/profit/cost";
import { shopCurrency } from "@/core/discounts/discounts";

/**
 * Списание товара с причиной. Остаток уменьшается условной записью «остаток
 * всё ещё тот, что прочитали» (как списание в заказе): заказ, прошедший между
 * чтением и записью, не теряется, а лишнего не спишешь — больше остатка отказ.
 *
 * Событие `stock.writeoff` в `zernio_logs` (как вся история остатка) несёт
 * причину, комментарий и себестоимость штуки НА МОМЕНТ списания: убыток на
 * «Прибыли» считается по ней, поэтому позднейшая правка себестоимости
 * прошлые списания не пересчитывает. Нет себестоимости — списание учтено
 * в штуках, а в деньги не переводится (число не выдумываем).
 */
export const WRITEOFF_REASONS = ["defect", "loss", "own", "other"] as const;
export type WriteoffReason = (typeof WRITEOFF_REASONS)[number];

export const WRITEOFF_EVENT = `${STOCK_EVENT_PREFIX}writeoff`;
export const WRITEOFF_PAGE = 20;

export type WriteoffInput = {
  productId: string;
  qty: number;
  reason: WriteoffReason;
  comment?: string;
};

export type WriteoffResult = {
  from: number;
  to: number;
  unitCost: number | null;
  currency: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function writeOff(
  ctx: TenantContext,
  input: WriteoffInput,
  actor: string,
): Promise<WriteoffResult> {
  if (!UUID.test(input.productId))
    throw new UserError("err.stock.receiptProduct", "Товар не найден.");
  if (!(WRITEOFF_REASONS as readonly string[]).includes(input.reason))
    throw new UserError("err.stock.writeoffReason", "Выберите причину списания.");
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 1_000_000)
    throw new UserError("err.stock.badQty", "Количество — целое число от 1 до {max}.", {
      max: 1_000_000,
    });
  const comment = (input.comment ?? "").trim().slice(0, 300);
  const currency = await shopCurrency(ctx);
  const cost = await loadCost(ctx, input.productId);
  const unit = unitCost(cost && cost.currency === currency ? cost : null, null);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: p, error } = await ctx.db
      .from("products")
      .select("stock_quantity")
      .eq("id", input.productId)
      .maybeSingle();
    if (error) throw serverFailure(`Списание: ${error.message}`);
    if (!p) throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    if (p.stock_quantity === null)
      throw new UserError(
        "err.stock.untracked",
        "У товара не ведётся остаток — включите учёт в карточке товара.",
      );
    if (input.qty > p.stock_quantity)
      throw new UserError(
        "err.stock.writeoffTooMuch",
        "Нельзя списать {qty} шт.: на складе {stock}.",
        { qty: input.qty, stock: p.stock_quantity },
      );
    const { data, error: e2 } = await ctx.db
      .from("products")
      .update({ stock_quantity: p.stock_quantity - input.qty })
      .eq("id", input.productId)
      .eq("stock_quantity", p.stock_quantity)
      .select("id")
      .maybeSingle();
    if (e2) throw serverFailure(`Списание: ${e2.message}`);
    if (!data) continue;
    const to = p.stock_quantity - input.qty;
    await recordStockChange(
      ctx,
      { productId: input.productId, from: p.stock_quantity, to },
      {
        reason: "writeoff",
        actor,
        extra: {
          writeoff_reason: input.reason,
          ...(comment ? { comment } : {}),
          unit_cost: unit,
          currency,
        },
      },
    );
    return { from: p.stock_quantity, to, unitCost: unit, currency };
  }
  throw serverFailure("Списание: остаток меняется слишком часто, повторите");
}

export type WriteoffEntry = {
  id: string;
  at: string;
  productId: string;
  qty: number;
  reason: WriteoffReason | null;
  comment: string;
  unitCost: number | null;
  currency: string | null;
  actor: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseWriteoff(row: {
  id: string;
  created_at: string;
  payload: unknown;
}): WriteoffEntry | null {
  const p =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : null;
  if (!p || typeof p.product_id !== "string") return null;
  const from = num(p.from);
  const to = num(p.to);
  if (from === null || to === null || from <= to) return null;
  const reason = (WRITEOFF_REASONS as readonly string[]).includes(String(p.writeoff_reason))
    ? (p.writeoff_reason as WriteoffReason)
    : null;
  return {
    id: row.id,
    at: row.created_at,
    productId: p.product_id,
    qty: from - to,
    reason,
    comment: typeof p.comment === "string" ? p.comment : "",
    unitCost: num(p.unit_cost),
    currency: typeof p.currency === "string" ? p.currency : null,
    actor: typeof p.actor === "string" ? p.actor : "system",
  };
}

/** Страница списаний, свежие сверху; сортировка кончается id. */
export async function listWriteoffs(
  ctx: TenantContext,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ entries: Array<WriteoffEntry & { name: string }>; total: number }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const size = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? WRITEOFF_PAGE)));
  const { data, error, count } = await ctx.db
    .from("zernio_logs")
    .select("id, created_at, payload", { count: "exact" })
    .eq("status", "event")
    .eq("event_type", WRITEOFF_EVENT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page * size, page * size + size - 1);
  if (error) throw serverFailure(`Списания: ${error.message}`);
  const entries = (data ?? []).flatMap((r) => {
    const e = parseWriteoff(r);
    return e ? [e] : [];
  });
  const names = new Map(
    (
      await inChunks(
        entries.map((e) => e.productId),
        (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).order("id"),
        "Названия товаров списаний",
      )
    ).map((p) => [p.id, p.name]),
  );
  return {
    entries: entries.map((e) => ({ ...e, name: names.get(e.productId) ?? "—" })),
    total: count ?? entries.length,
  };
}

export type WriteoffTotals = {
  count: number;
  qty: number;
  /** Убыток по себестоимости на момент списания, в валюте магазина. */
  loss: number;
  /** Штуки, у которых себестоимости на момент списания не было. */
  unknownQty: number;
};

/** Итог по списаниям с `since`; другая валюта магазина — в штуки без денег. */
export async function writeoffTotals(
  ctx: TenantContext,
  since: string,
  currency: string,
  /** Какие списания входят в период (по дню магазина); без неё — все с `since`. */
  inPeriod: (iso: string) => boolean = () => true,
): Promise<WriteoffTotals> {
  const rows = await pageAll<{ id: string; created_at: string; payload: unknown }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, created_at, payload")
        .eq("status", "event")
        .eq("event_type", WRITEOFF_EVENT)
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    "Списания для прибыли",
  );
  const t: WriteoffTotals = { count: 0, qty: 0, loss: 0, unknownQty: 0 };
  for (const r of rows) {
    const e = parseWriteoff(r);
    if (!e || !inPeriod(e.at)) continue;
    t.count += 1;
    t.qty += e.qty;
    if (e.unitCost === null || e.currency !== currency) t.unknownQty += e.qty;
    else t.loss += e.qty * e.unitCost;
  }
  t.loss = Math.round(t.loss * 100) / 100;
  return t;
}
