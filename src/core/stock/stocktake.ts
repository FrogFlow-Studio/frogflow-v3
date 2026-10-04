import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, updateSettingStamped } from "@/core/settings/settings";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import { recordStockChange } from "@/core/catalog/stock-history";

/**
 * Инвентаризация. Продавец вводит фактический остаток; в момент ввода
 * запоминается, сколько на складе числилось (`expected`). «Подтвердить»
 * пишет РАЗНИЦУ `counted − expected` прибавлением к текущему остатку, а не
 * «записать посчитанное»: заказ, прошедший между вводом и подтверждением,
 * уже списал свои штуки, и они не воскресают. Если разница увела бы остаток
 * ниже нуля (заказы с тех пор продали больше, чем недосчитали), остаток
 * становится 0, а в событии — `clamped`.
 *
 * Сессия — одна строка `app_settings` `stock:stocktake` (схема не меняется),
 * одновременно открыта одна. Подтверждение — как проведение прихода: условное
 * `draft → posting` (выигрывает один), строки отмечаются по одной, оборванное
 * продолжается с невыполненных. Каждая строка — событие `stock.stocktake`.
 */
export const STOCKTAKE_KEY = "stock:stocktake";
export const STOCKTAKE_MAX_LINES = 5000;
export const STOCKTAKE_MAX_QTY = 1_000_000;
export const STOCKTAKE_PAGE = 50;
/** Дольше этого «posting» считается оборванным и забирается заново. */
export const STOCKTAKE_STALE_MS = 150_000;

export type StocktakeStatus = "draft" | "posting" | "partial" | "posted" | "cancelled";

export type CountLine = {
  counted: number;
  /** Сколько числилось в момент ввода. */
  expected: number;
  state?: "done" | "skipped";
  from?: number | null;
  to?: number | null;
  clamped?: boolean;
};

export type Stocktake = {
  id: string;
  status: StocktakeStatus;
  lines: Record<string, CountLine>;
  startedAt: string;
  startedBy: string;
  postedAt: string | null;
  claim: string | null;
  postingAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly StocktakeStatus[] = ["draft", "posting", "partial", "posted", "cancelled"];
const OPEN: readonly StocktakeStatus[] = ["draft", "posting", "partial"];

export const diffOf = (l: CountLine) => l.counted - l.expected;

export function parseStocktake(raw: string | null | undefined): Stocktake | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Stocktake> | null;
    if (!j || typeof j !== "object" || typeof j.id !== "string") return null;
    if (!STATUSES.includes(j.status as StocktakeStatus)) return null;
    const lines: Record<string, CountLine> = {};
    for (const [pid, l] of Object.entries(j.lines ?? {})) {
      if (!UUID.test(pid) || !l) continue;
      if (!Number.isInteger(l.counted) || !Number.isInteger(l.expected)) continue;
      lines[pid] = l;
    }
    return {
      id: j.id,
      status: j.status as StocktakeStatus,
      lines,
      startedAt: String(j.startedAt ?? ""),
      startedBy: String(j.startedBy ?? "system"),
      postedAt: typeof j.postedAt === "string" ? j.postedAt : null,
      claim: typeof j.claim === "string" ? j.claim : null,
      postingAt: typeof j.postingAt === "string" ? j.postingAt : null,
    };
  } catch {
    return null;
  }
}

/** Текущая сессия: открытая или последняя завершённая; сбой чтения — сбой. */
export async function loadStocktake(ctx: TenantContext): Promise<Stocktake | null> {
  const doc = parseStocktake(await getSettingStrict(ctx, STOCKTAKE_KEY));
  return doc && doc.status !== "cancelled" ? doc : null;
}

function writeFailed(): Error {
  return serverFailure("Инвентаризация не сохранилась");
}

/** Начать инвентаризацию; уже открытая возвращается как есть. */
export async function startStocktake(
  ctx: TenantContext,
  actor: string,
  now = new Date(),
): Promise<Stocktake> {
  let created: Stocktake | null = null;
  const r = await updateSettingStamped(ctx, STOCKTAKE_KEY, (raw) => {
    const cur = parseStocktake(raw);
    if (cur && OPEN.includes(cur.status)) return null;
    created = {
      id: randomUUID(),
      status: "draft",
      lines: {},
      startedAt: now.toISOString(),
      startedBy: actor,
      postedAt: null,
      claim: null,
      postingAt: null,
    };
    return JSON.stringify(created);
  });
  if (r === "failed") throw writeFailed();
  if (r === "written" && created) return created;
  const cur = await loadStocktake(ctx);
  if (!cur) throw writeFailed();
  return cur;
}

/** Ввести (или стереть: counted = null) фактический остаток товара. */
export async function setCount(
  ctx: TenantContext,
  id: string,
  productId: string,
  counted: number | null,
): Promise<void> {
  if (!UUID.test(productId)) throw new UserError("err.stock.receiptProduct", "Товар не найден.");
  if (
    counted !== null &&
    (!Number.isInteger(counted) || counted < 0 || counted > STOCKTAKE_MAX_QTY)
  )
    throw new UserError("err.stock.badCount", "Фактический остаток — целое число от 0 до {max}.", {
      max: STOCKTAKE_MAX_QTY,
    });
  let expected = 0;
  if (counted !== null) {
    const { data: p, error } = await ctx.db
      .from("products")
      .select("stock_quantity, fulfillment_kind")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw serverFailure(`Инвентаризация: ${error.message}`);
    if (!p) throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    if (p.stock_quantity === null || p.fulfillment_kind === "digital")
      throw new UserError(
        "err.stock.untracked",
        "У товара не ведётся остаток — включите учёт в карточке товара.",
      );
    expected = p.stock_quantity;
  }
  let closed = false;
  let tooMany = false;
  const r = await updateSettingStamped(ctx, STOCKTAKE_KEY, (raw) => {
    const d = parseStocktake(raw);
    if (!d || d.id !== id || d.status !== "draft") {
      closed = true;
      return null;
    }
    const lines = { ...d.lines };
    if (counted === null) delete lines[productId];
    else {
      if (!(productId in lines) && Object.keys(lines).length >= STOCKTAKE_MAX_LINES) {
        tooMany = true;
        return null;
      }
      lines[productId] = { counted, expected };
    }
    return JSON.stringify({ ...d, lines });
  });
  if (closed)
    throw new UserError(
      "err.stock.stocktakeClosed",
      "Инвентаризация уже подтверждена или отменена — начните новую.",
    );
  if (tooMany)
    throw new UserError("err.stock.stocktakeTooBig", "В инвентаризации не больше {max} товаров.", {
      max: STOCKTAKE_MAX_LINES,
    });
  if (r !== "written") throw writeFailed();
}

/** Отменить открытую инвентаризацию (до подтверждения). */
export async function cancelStocktake(ctx: TenantContext, id: string): Promise<void> {
  let closed = false;
  const r = await updateSettingStamped(ctx, STOCKTAKE_KEY, (raw) => {
    const d = parseStocktake(raw);
    if (!d || d.id !== id || d.status !== "draft") {
      closed = true;
      return null;
    }
    return JSON.stringify({ ...d, status: "cancelled" });
  });
  if (closed)
    throw new UserError(
      "err.stock.stocktakeClosed",
      "Инвентаризация уже подтверждена или отменена — начните новую.",
    );
  if (r !== "written") throw writeFailed();
}

export type CountItem = {
  id: string;
  name: string;
  stock: number;
  counted: number | null;
  expected: number | null;
};

/** Товары с учётом остатка постранично; сортировка кончается id; `total` — всего. */
export async function listCountItems(
  ctx: TenantContext,
  doc: Stocktake | null,
  opts: { page?: number; q?: string } = {},
): Promise<{ items: CountItem[]; total: number }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  let q = ctx.db
    .from("products")
    .select("id, name, stock_quantity", { count: "exact" })
    .not("stock_quantity", "is", null)
    .neq("fulfillment_kind", "digital");
  const term = (opts.q ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&")
    .replace(/[,()*]/g, "_");
  if (term) q = q.ilike("name", `%${term}%`);
  const { data, error, count } = await q
    .order("name")
    .order("id")
    .range(page * STOCKTAKE_PAGE, page * STOCKTAKE_PAGE + STOCKTAKE_PAGE - 1);
  if (error) throw serverFailure(`Инвентаризация: ${error.message}`);
  return {
    items: (data ?? []).map((p) => {
      const l = doc?.lines[p.id];
      return {
        id: p.id,
        name: p.name,
        stock: p.stock_quantity ?? 0,
        counted: l ? l.counted : null,
        expected: l ? l.expected : null,
      };
    }),
    total: count ?? (data ?? []).length,
  };
}

export type Discrepancy = {
  productId: string;
  name: string;
  expected: number;
  counted: number;
  diff: number;
  /** Остаток сейчас: если он ушёл от `expected`, между вводом и подтверждением были заказы. */
  stock: number | null;
  state: CountLine["state"] | null;
};

/** Расхождения сессии (разница ≠ 0) с названиями и остатком сейчас; все, без обрезки. */
export async function discrepancies(ctx: TenantContext, doc: Stocktake): Promise<Discrepancy[]> {
  const diffs = Object.entries(doc.lines).filter(([, l]) => diffOf(l) !== 0);
  const rows = await inChunks(
    diffs.map(([pid]) => pid),
    (chunk) =>
      ctx.db.from("products").select("id, name, stock_quantity").in("id", chunk).order("id"),
    "Расхождения инвентаризации",
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return diffs
    .map(([pid, l]) => ({
      productId: pid,
      name: byId.get(pid)?.name ?? "—",
      expected: l.expected,
      counted: l.counted,
      diff: diffOf(l),
      stock: byId.get(pid)?.stock_quantity ?? null,
      state: l.state ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId));
}

async function applyDelta(
  ctx: TenantContext,
  productId: string,
  delta: number,
): Promise<{ from: number; to: number; clamped: boolean } | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: p, error } = await ctx.db
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw serverFailure(`Инвентаризация: ${error.message}`);
    if (!p || p.stock_quantity === null) return null;
    const raw = p.stock_quantity + delta;
    const to = Math.max(0, raw);
    const { data, error: e2 } = await ctx.db
      .from("products")
      .update({ stock_quantity: to })
      .eq("id", productId)
      .eq("stock_quantity", p.stock_quantity)
      .select("id")
      .maybeSingle();
    if (e2) throw serverFailure(`Инвентаризация: ${e2.message}`);
    if (data) return { from: p.stock_quantity, to, clamped: raw < 0 };
  }
  throw serverFailure("Инвентаризация: остаток меняется слишком часто, повторите подтверждение");
}

async function saveProgress(
  ctx: TenantContext,
  claim: string,
  change: (d: Stocktake) => Stocktake,
): Promise<void> {
  const r = await updateSettingStamped(ctx, STOCKTAKE_KEY, (raw) => {
    const d = parseStocktake(raw);
    if (!d || d.claim !== claim) return null;
    return JSON.stringify(change(d));
  });
  if (r === "skipped")
    throw new UserError(
      "err.stock.stocktakeTaken",
      "Инвентаризацию подтверждает другой сотрудник — обновите страницу.",
    );
  if (r !== "written") throw serverFailure("Ход инвентаризации не записался");
}

/** Подтвердить: разницы прибавляются к остаткам; повторное подтверждение ничего не делает. */
export async function confirmStocktake(
  ctx: TenantContext,
  id: string,
  actor: string,
  now = new Date(),
): Promise<Stocktake> {
  const claim = randomUUID();
  let claimed: Stocktake | null = null;
  let seen = false;
  const r = await updateSettingStamped(ctx, STOCKTAKE_KEY, (raw) => {
    const d = parseStocktake(raw);
    if (!d || d.id !== id || d.status === "cancelled") return null;
    seen = true;
    const stale =
      d.status === "posting" &&
      (!d.postingAt || now.getTime() - Date.parse(d.postingAt) > STOCKTAKE_STALE_MS);
    if (d.status !== "draft" && d.status !== "partial" && !stale) return null;
    claimed = { ...d, status: "posting", claim, postingAt: now.toISOString() };
    return JSON.stringify(claimed);
  });
  if (r === "failed") throw serverFailure("Инвентаризацию не удалось взять в работу");
  if (r === "skipped" || !claimed) {
    if (!seen)
      throw new UserError(
        "err.stock.stocktakeClosed",
        "Инвентаризация уже подтверждена или отменена — начните новую.",
      );
    throw new UserError(
      "err.stock.stocktakePosted",
      "Инвентаризация уже подтверждена или подтверждается — повторно остаток не меняется.",
    );
  }
  const doc: Stocktake = claimed;
  try {
    for (const [productId, line] of Object.entries(doc.lines)) {
      if (line.state || diffOf(line) === 0) continue;
      const res = await applyDelta(ctx, productId, diffOf(line));
      const done: CountLine = res
        ? {
            ...line,
            state: "done",
            from: res.from,
            to: res.to,
            ...(res.clamped ? { clamped: true } : {}),
          }
        : { ...line, state: "skipped", from: null, to: null };
      if (res)
        await recordStockChange(
          ctx,
          { productId, from: res.from, to: res.to },
          {
            reason: "stocktake",
            actor,
            extra: {
              expected: line.expected,
              counted: line.counted,
              ...(res.clamped ? { clamped: true } : {}),
            },
          },
        );
      if (res && diffOf(line) > 0)
        await (
          await import("@/core/catalog/low-stock")
        )
          .resetLowStock(ctx, productId)
          .catch((e) => console.error(`[stock] отметка «заканчивается» не снята: ${String(e)}`));
      await saveProgress(ctx, claim, (d) => ({ ...d, lines: { ...d.lines, [productId]: done } }));
    }
  } catch (e) {
    await saveProgress(ctx, claim, (d) => ({ ...d, status: "partial", claim: null })).catch(
      () => {},
    );
    throw e;
  }
  let finished: Stocktake | null = null;
  await saveProgress(ctx, claim, (d) => {
    finished = { ...d, status: "posted", claim: null, postedAt: now.toISOString() };
    return finished;
  });
  return finished ?? doc;
}
