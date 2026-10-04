import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { eachPage } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { shopDateTime, toCsv, zonedDayToUtc } from "@/core/export/csv";
import { displayNo } from "@/core/orders/pure";
import { STOCK_EVENT_PREFIX, STOCK_REASONS, type StockReason } from "@/core/catalog/stock-history";
import { loadSuppliers } from "./suppliers";

/**
 * Журнал склада: все движения остатка магазина (события `stock.<причина>` в
 * `zernio_logs`), свежие сверху. Фильтры — товар, причина, поставщик (приходы
 * от него: в событии прихода лежит `supplier_id`) и даты по дню магазина.
 *
 * Сортировка кончается `id`, чтобы события одной секунды не менялись местами
 * между страницами; страницы и CSV читаются постранично, без обрезки.
 *
 * Хранение: приходы, списания и инвентаризации — учёт, а не журнал, их
 * ночная чистка (core/retention) не удаляет; остальные движения (заказ,
 * отмена, правка…) хранятся 180 дней, как раньше.
 */
export const JOURNAL_PAGE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type JournalFilter = {
  productId?: string | null;
  reason?: StockReason | null;
  supplierId?: string | null;
  /** Дни магазина, YYYY-MM-DD, обе границы включительно. */
  from?: string | null;
  to?: string | null;
};

export type JournalEntry = {
  id: string;
  at: string;
  reason: StockReason;
  productId: string;
  name: string;
  from: number | null;
  to: number | null;
  orderNo: number | null;
  receiptNo: number | null;
  supplierId: string | null;
  supplierName: string | null;
  /** Причина списания или комментарий — для подписи. */
  note: string;
  actor: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Фильтр из строк запроса; всё неверное отбрасывается, а не превращается в «всё». */
export function parseJournalFilter(q: Record<string, string | null | undefined>): JournalFilter {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const reason = (STOCK_REASONS as readonly string[]).includes(q.reason ?? "")
    ? (q.reason as StockReason)
    : null;
  return {
    productId: q.productId && uuid.test(q.productId) ? q.productId : null,
    supplierId: q.supplierId && uuid.test(q.supplierId) ? q.supplierId : null,
    reason,
    from: q.from && DAY.test(q.from) ? q.from : null,
    to: q.to && DAY.test(q.to) ? q.to : null,
  };
}

type Row = { id: string; created_at: string; event_type: string; payload: unknown };

function baseQuery(ctx: TenantContext, f: JournalFilter, count: boolean) {
  const tz = ctx.timezone;
  let q = ctx.db
    .from("zernio_logs")
    .select("id, created_at, event_type, payload", count ? { count: "exact" } : undefined)
    .eq("status", "event");
  q = f.reason
    ? q.eq("event_type", `${STOCK_EVENT_PREFIX}${f.reason}`)
    : q.like("event_type", `${STOCK_EVENT_PREFIX}%`);
  if (f.productId) q = q.eq("payload->>product_id", f.productId);
  if (f.supplierId) q = q.eq("payload->>supplier_id", f.supplierId);
  if (f.from) q = q.gte("created_at", zonedDayToUtc(f.from, tz));
  if (f.to) q = q.lte("created_at", zonedDayToUtc(f.to, tz, true));
  return q.order("created_at", { ascending: false }).order("id", { ascending: false });
}

/** Названия товаров, номера заказов и имена поставщиков для пачки строк. */
async function describe(ctx: TenantContext, rows: Row[]): Promise<JournalEntry[]> {
  const known = new Set<string>(STOCK_REASONS);
  const parsed = rows.flatMap((r) => {
    const reason = r.event_type.slice(STOCK_EVENT_PREFIX.length);
    const p =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : null;
    const productId = p ? str(p.product_id) : null;
    if (!known.has(reason) || !p || !productId) return [];
    return [{ r, reason: reason as StockReason, p, productId }];
  });
  const names = new Map(
    (
      await inChunks(
        parsed.map((x) => x.productId),
        (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).order("id"),
        "Журнал склада: товары",
      )
    ).map((p) => [p.id, p.name]),
  );
  const orderIds = parsed.flatMap((x) => (num(x.p.order_id) === null ? [] : [num(x.p.order_id)!]));
  const orderNos = new Map(
    (
      await inChunks(
        orderIds,
        (chunk) =>
          ctx.db.from("orders").select("id, order_no, display_no").in("id", chunk).order("id"),
        "Журнал склада: заказы",
      )
    ).map((o) => [Number(o.id), displayNo(o)]),
  );
  const suppliers = new Map((await loadSuppliers(ctx)).items.map((s) => [s.id, s.name]));
  return parsed.map(({ r, reason, p, productId }) => {
    const orderId = num(p.order_id);
    const supplierId = str(p.supplier_id);
    return {
      id: r.id,
      at: r.created_at,
      reason,
      productId,
      name: names.get(productId) ?? "—",
      from: num(p.from),
      to: num(p.to),
      orderNo: orderId === null ? null : (orderNos.get(orderId) ?? null),
      receiptNo: num(p.receipt_no),
      supplierId,
      supplierName: supplierId ? (suppliers.get(supplierId) ?? null) : null,
      note: str(p.comment) ?? str(p.writeoff_reason) ?? "",
      actor: str(p.actor) ?? "system",
    };
  });
}

export async function listJournal(
  ctx: TenantContext,
  filter: JournalFilter,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ entries: JournalEntry[]; total: number }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const size = Math.min(200, Math.max(1, Math.floor(opts.pageSize ?? JOURNAL_PAGE)));
  const { data, error, count } = await baseQuery(ctx, filter, true).range(
    page * size,
    page * size + size - 1,
  );
  if (error) throw serverFailure(`Журнал склада: ${error.message}`);
  const rows = (data ?? []) as Row[];
  return { entries: await describe(ctx, rows), total: count ?? rows.length };
}

export const JOURNAL_REASON_RU: Record<StockReason, string> = {
  order: "Заказ",
  cancel: "Отмена заказа",
  refund: "Возврат",
  manual_order: "Ручной заказ",
  edit: "Правка карточки",
  bulk: "Массовое действие",
  import: "Импорт",
  sheet: "Таблица Google",
  api: "Внешний API",
  receipt: "Приход",
  writeoff: "Списание",
  stocktake: "Инвентаризация",
  bundle: "Набор",
};

export const JOURNAL_CSV_COLUMNS = [
  "Дата",
  "Товар",
  "Причина",
  "Было",
  "Стало",
  "Изменение",
  "Заказ №",
  "Приход №",
  "Поставщик",
  "Комментарий",
  "Кто",
];

/** CSV по тому же фильтру; все страницы, без обрезки. */
export async function journalCsv(
  ctx: TenantContext,
  filter: JournalFilter,
): Promise<{ csv: string; count: number }> {
  const tz = ctx.timezone;
  const out: unknown[][] = [];
  await eachPage(
    (from, to) => baseQuery(ctx, filter, false).range(from, to),
    "Журнал склада",
    async (rows) => {
      for (const e of await describe(ctx, rows)) {
        const delta = e.from !== null && e.to !== null ? e.to - e.from : "";
        out.push([
          shopDateTime(e.at, tz),
          e.name,
          JOURNAL_REASON_RU[e.reason],
          e.from ?? "не учитывался",
          e.to ?? "не учитывался",
          delta,
          e.orderNo ?? "",
          e.receiptNo ?? "",
          e.supplierName ?? "",
          e.note,
          e.actor,
        ]);
      }
    },
  );
  return { csv: toCsv(JOURNAL_CSV_COLUMNS, out), count: out.length };
}
