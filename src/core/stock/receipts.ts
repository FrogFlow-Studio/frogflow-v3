import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  getSettingStrict,
  updateSettingAtomic,
  updateSettingStamped,
} from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { recordStockChange } from "@/core/catalog/stock-history";
import { COST_MAX, loadCost, saveCost, unitCost } from "@/core/profit/cost";
import { shopCurrency } from "@/core/discounts/discounts";
import { closeRequestByReceipt } from "./requests";

/**
 * Приход товара. Документ — строка `app_settings` `stock:receipt:<id>` (схема
 * не меняется), номер — счётчик `stock:receipt_seq`. Жизнь документа:
 *
 *   draft → posting → posted        (partial — проведение оборвалось, повторить можно)
 *   draft → deleted                 (удалить можно только черновик)
 *
 * «Провести» — условное обновление документа: только выигравший переводит
 * draft → posting и прибавляет остаток; повторный клик, второй сотрудник и
 * крон видят «уже проводится/проведён» и ничего не делают. Каждая строка
 * прибавляется условной записью «остаток всё ещё тот, что прочитали» (как
 * списание в заказе), поэтому заказ во время проведения не теряет списание.
 * Выполненные строки отмечаются в документе сразу: оборванное проведение
 * (`partial` или `posting` старше POSTING_STALE_MS) продолжает только
 * невыполненные. Окно между записью остатка и отметкой строки — единственное
 * место, где обрыв процесса может дать повтор одной строки; оно в одну запись.
 *
 * Остаток у вариантов общий на товар (`product_variants` своего остатка не
 * имеет), поэтому вариант в строке нужен только себестоимости: она ведётся по
 * варианту отдельно, а вес старой партии — общий остаток товара.
 */
export const RECEIPT_PREFIX = "stock:receipt:";
export const RECEIPT_SEQ_KEY = "stock:receipt_seq";
export const RECEIPT_MAX_LINES = 100;
export const RECEIPT_MAX_QTY = 1_000_000;
/** Дольше этого «posting» считается оборванным и забирается заново. */
export const POSTING_STALE_MS = 150_000;

export const receiptKey = (id: string) => `${RECEIPT_PREFIX}${id}`;

export type ReceiptStatus = "draft" | "posting" | "partial" | "posted" | "deleted";
export type LineState = "done" | "skipped";

export type ReceiptLine = {
  productId: string;
  /** Название варианта: только для себестоимости; null — товар целиком. */
  variant: string | null;
  qty: number;
  /** Закупочная цена за штуку в валюте магазина. */
  price: number;
  state?: LineState;
  /** Остаток до и после (после проведения). */
  from?: number | null;
  to?: number | null;
  /** Себестоимость после проведения; costFailed — остаток прибавлен, а себестоимость не записалась. */
  cost?: number | null;
  costFailed?: boolean;
};

export type Receipt = {
  id: string;
  no: number;
  supplierId: string | null;
  lines: ReceiptLine[];
  /** Обновить себестоимость средневзвешенно при проведении. */
  updateCost: boolean;
  status: ReceiptStatus;
  createdAt: string;
  createdBy: string;
  postedAt: string | null;
  /** Метка того, кто сейчас проводит. */
  claim: string | null;
  postingAt: string | null;
  /** Заявка поставщику, которую этот приход закрывает (С5). */
  requestId: string | null;
};

export type ReceiptInput = {
  supplierId: string | null;
  lines: Array<{ productId: string; variant?: string | null; qty: number; price: number }>;
  updateCost: boolean;
  requestId?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly ReceiptStatus[] = ["draft", "posting", "partial", "posted", "deleted"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Средневзвешенная себестоимость; нет прежней или нет остатка — цена прихода. */
export function weightedCost(
  oldStock: number,
  oldCost: number | null,
  qty: number,
  price: number,
): number {
  if (oldCost === null || oldStock <= 0) return round2(price);
  return round2((oldStock * oldCost + qty * price) / (oldStock + qty));
}

export function parseReceipt(raw: string | null | undefined): Receipt | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Receipt> | null;
    if (!j || typeof j !== "object") return null;
    if (typeof j.id !== "string" || !UUID.test(j.id)) return null;
    if (!Number.isInteger(j.no) || !STATUSES.includes(j.status as ReceiptStatus)) return null;
    if (!Array.isArray(j.lines)) return null;
    return {
      id: j.id,
      no: j.no as number,
      supplierId: typeof j.supplierId === "string" ? j.supplierId : null,
      lines: j.lines as ReceiptLine[],
      updateCost: j.updateCost === true,
      status: j.status as ReceiptStatus,
      createdAt: String(j.createdAt ?? ""),
      createdBy: String(j.createdBy ?? "system"),
      postedAt: typeof j.postedAt === "string" ? j.postedAt : null,
      claim: typeof j.claim === "string" ? j.claim : null,
      postingAt: typeof j.postingAt === "string" ? j.postingAt : null,
      requestId: typeof j.requestId === "string" ? j.requestId : null,
    };
  } catch {
    return null;
  }
}

async function nextNumber(ctx: TenantContext): Promise<number> {
  let no = 0;
  const r = await updateSettingAtomic(ctx, RECEIPT_SEQ_KEY, (raw) => {
    const n = Number(raw);
    no = (Number.isInteger(n) && n >= 0 ? n : 0) + 1;
    return String(no);
  });
  if (r !== "written") throw serverFailure("Номер прихода не выдан");
  return no;
}

/** Проверка строк по базе: товар физический с учётом остатка, вариант существует, цифры в границах. */
async function checkLines(ctx: TenantContext, input: ReceiptInput): Promise<ReceiptLine[]> {
  if (input.lines.length === 0)
    throw new UserError("err.stock.receiptEmpty", "Добавьте в приход хотя бы одну позицию.");
  if (input.lines.length > RECEIPT_MAX_LINES)
    throw new UserError("err.stock.receiptTooBig", "В приходе не больше {max} позиций.", {
      max: RECEIPT_MAX_LINES,
    });
  const out: ReceiptLine[] = [];
  const seen = new Set<string>();
  for (const l of input.lines) {
    const variant = l.variant?.trim() || null;
    const dup = `${l.productId}\u0000${variant ?? ""}`;
    if (!UUID.test(l.productId))
      throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    if (seen.has(dup))
      throw new UserError("err.stock.receiptDuplicate", "Одна и та же позиция указана дважды.");
    seen.add(dup);
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > RECEIPT_MAX_QTY)
      throw new UserError("err.stock.badQty", "Количество — целое число от 1 до {max}.", {
        max: RECEIPT_MAX_QTY,
      });
    if (!Number.isFinite(l.price) || l.price < 0 || l.price > COST_MAX)
      throw new UserError("err.stock.badPrice", "Цена закупки — число от 0 до 1 000 000 000.");
    const prod = await ctx.db
      .from("products")
      .select("id, stock_quantity, fulfillment_kind")
      .eq("id", l.productId)
      .maybeSingle();
    if (prod.error) throw serverFailure(`Товар для прихода: ${prod.error.message}`);
    if (!prod.data) throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    if (prod.data.fulfillment_kind === "digital" || prod.data.stock_quantity === null)
      throw new UserError(
        "err.stock.untracked",
        "У товара не ведётся остаток — включите учёт в карточке товара.",
      );
    if (variant) {
      const v = await ctx.db
        .from("product_variants")
        .select("id")
        .eq("product_id", l.productId)
        .eq("name", variant)
        .limit(1);
      if (v.error) throw serverFailure(`Вариант для прихода: ${v.error.message}`);
      if (!v.data?.length) throw new UserError("err.cost.noVariant", "Вариант товара не найден.");
    }
    out.push({ productId: l.productId, variant, qty: l.qty, price: round2(l.price) });
  }
  return out;
}

export async function createReceipt(
  ctx: TenantContext,
  input: ReceiptInput,
  actor: string,
  now = new Date(),
): Promise<Receipt> {
  const lines = await checkLines(ctx, input);
  const no = await nextNumber(ctx);
  const doc: Receipt = {
    id: randomUUID(),
    no,
    supplierId: input.supplierId,
    lines,
    updateCost: input.updateCost,
    status: "draft",
    createdAt: now.toISOString(),
    createdBy: actor,
    postedAt: null,
    claim: null,
    postingAt: null,
    requestId: input.requestId ?? null,
  };
  const r = await updateSettingStamped(ctx, receiptKey(doc.id), (raw) =>
    raw == null ? JSON.stringify(doc) : null,
  );
  if (r !== "written") throw serverFailure("Приход не сохранился");
  return doc;
}

/** Правка и удаление — только черновика. */
async function editDraft(
  ctx: TenantContext,
  id: string,
  edit: (d: Receipt) => Receipt,
): Promise<Receipt> {
  let result: Receipt | null = null;
  let notFound = false;
  const r = await updateSettingStamped(ctx, receiptKey(id), (raw) => {
    const d = parseReceipt(raw);
    if (!d || d.status === "deleted") {
      notFound = true;
      return null;
    }
    if (d.status !== "draft") return null;
    result = edit(d);
    return JSON.stringify(result);
  });
  if (notFound) throw new UserError("err.stock.receiptNotFound", "Приход не найден.");
  if (r === "skipped")
    throw new UserError(
      "err.stock.receiptNotDraft",
      "Приход уже проводится или проведён — изменить его нельзя.",
    );
  if (r !== "written" || !result) throw serverFailure("Приход не сохранился");
  return result;
}

export async function updateReceipt(
  ctx: TenantContext,
  id: string,
  input: ReceiptInput,
): Promise<Receipt> {
  const lines = await checkLines(ctx, input);
  return editDraft(ctx, id, (d) => ({
    ...d,
    supplierId: input.supplierId,
    lines,
    updateCost: input.updateCost,
  }));
}

export async function deleteReceipt(ctx: TenantContext, id: string): Promise<void> {
  await editDraft(ctx, id, (d) => ({ ...d, status: "deleted" }));
}

export async function loadReceipt(ctx: TenantContext, id: string): Promise<Receipt | null> {
  if (!UUID.test(id)) return null;
  const d = parseReceipt(await getSettingStrict(ctx, receiptKey(id)));
  return d && d.status !== "deleted" ? d : null;
}

/** Все приходы, свежие сверху; постранично, без обрезки. */
export async function listReceipts(ctx: TenantContext): Promise<Receipt[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${RECEIPT_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Приходы не прочитались",
  );
  const out: Receipt[] = [];
  for (const r of rows) {
    const d = parseReceipt(r.value);
    if (d && d.status !== "deleted" && r.key === receiptKey(d.id)) out.push(d);
  }
  return out.sort((a, b) => b.no - a.no);
}

/** Прибавить к остатку условной записью. Возвращает «было → стало» или null — остаток не ведётся. */
async function addStock(
  ctx: TenantContext,
  productId: string,
  qty: number,
): Promise<{ from: number; to: number } | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: p, error } = await ctx.db
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw serverFailure(`Приход: ${error.message}`);
    if (!p || p.stock_quantity === null) return null;
    const { data, error: e2 } = await ctx.db
      .from("products")
      .update({ stock_quantity: p.stock_quantity + qty })
      .eq("id", productId)
      .eq("stock_quantity", p.stock_quantity)
      .select("id")
      .maybeSingle();
    if (e2) throw serverFailure(`Приход: ${e2.message}`);
    if (data) return { from: p.stock_quantity, to: p.stock_quantity + qty };
  }
  throw serverFailure("Приход: остаток меняется слишком часто, повторите проведение");
}

/** Новая себестоимость строки; null — не считаем (нет цены или другая валюта). */
async function costAfter(
  ctx: TenantContext,
  line: ReceiptLine,
  stockBefore: number,
): Promise<number> {
  const cur = await shopCurrency(ctx);
  const prev = await loadCost(ctx, line.productId);
  const usable = prev && prev.currency === cur ? prev : null;
  return weightedCost(stockBefore, unitCost(usable, line.variant), line.qty, line.price);
}

async function applyLine(
  ctx: TenantContext,
  doc: Receipt,
  line: ReceiptLine,
  actor: string,
): Promise<ReceiptLine> {
  const added = await addStock(ctx, line.productId, line.qty);
  if (!added) return { ...line, state: "skipped", from: null, to: null };
  await recordStockChange(
    ctx,
    { productId: line.productId, from: added.from, to: added.to },
    {
      reason: "receipt",
      actor,
      receiptNo: doc.no,
      extra: doc.supplierId ? { supplier_id: doc.supplierId } : undefined,
    },
  );
  await (
    await import("@/core/catalog/low-stock")
  )
    .resetLowStock(ctx, line.productId)
    .catch((e) => console.error(`[stock] отметка «заканчивается» не снята: ${String(e)}`));
  const done: ReceiptLine = { ...line, state: "done", from: added.from, to: added.to };
  if (doc.updateCost) {
    try {
      const cost = await costAfter(ctx, line, added.from);
      await saveCost(
        ctx,
        line.productId,
        line.variant ? { variants: { [line.variant]: cost } } : { price: cost },
      );
      done.cost = cost;
    } catch (e) {
      // Остаток уже прибавлен: сбой себестоимости не откатывает приход, но виден в документе.
      console.error(`[stock] себестоимость прихода не записана: ${String(e)}`);
      done.costFailed = true;
    }
  }
  return done;
}

/** Записать результат строки в документ, пока им владеет наш claim. */
async function saveProgress(
  ctx: TenantContext,
  id: string,
  claim: string,
  change: (d: Receipt) => Receipt,
): Promise<void> {
  const r = await updateSettingStamped(ctx, receiptKey(id), (raw) => {
    const d = parseReceipt(raw);
    if (!d || d.claim !== claim) return null;
    return JSON.stringify(change(d));
  });
  if (r === "skipped")
    throw new UserError(
      "err.stock.receiptTaken",
      "Приход проводит другой сотрудник — обновите страницу.",
    );
  if (r !== "written") throw serverFailure("Ход проведения прихода не записался");
}

/**
 * Провести приход. Выиграл условное «draft → posting» — прибавляет остаток;
 * проигравший получает отказ и ничего не меняет.
 */
export async function postReceipt(
  ctx: TenantContext,
  id: string,
  actor: string,
  now = new Date(),
): Promise<Receipt> {
  const claim = randomUUID();
  let claimed: Receipt | null = null;
  let status: ReceiptStatus | null = null;
  const r = await updateSettingStamped(ctx, receiptKey(id), (raw) => {
    const d = parseReceipt(raw);
    if (!d || d.status === "deleted") return null;
    status = d.status;
    const stale =
      d.status === "posting" &&
      (!d.postingAt || now.getTime() - Date.parse(d.postingAt) > POSTING_STALE_MS);
    if (d.status !== "draft" && d.status !== "partial" && !stale) return null;
    claimed = { ...d, status: "posting", claim, postingAt: now.toISOString() };
    return JSON.stringify(claimed);
  });
  if (r === "failed") throw serverFailure("Приход не удалось взять в проведение");
  if (r === "skipped" || !claimed) {
    if (status === null) throw new UserError("err.stock.receiptNotFound", "Приход не найден.");
    throw new UserError(
      "err.stock.receiptPosted",
      "Приход уже проведён или проводится — повторно остаток не прибавляется.",
    );
  }
  const doc: Receipt = claimed;
  try {
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i]!;
      if (line.state) continue;
      const done = await applyLine(ctx, doc, line, actor);
      await saveProgress(ctx, id, claim, (d) => ({
        ...d,
        lines: d.lines.map((l, k) => (k === i ? done : l)),
      }));
    }
  } catch (e) {
    // Оборвалось: выполненное отмечено, остальное можно провести повторно сразу.
    await saveProgress(ctx, id, claim, (d) => ({ ...d, status: "partial", claim: null })).catch(
      () => {},
    );
    throw e;
  }
  let finished: Receipt | null = null;
  await saveProgress(ctx, id, claim, (d) => {
    finished = { ...d, status: "posted", claim: null, postedAt: now.toISOString() };
    return finished;
  });
  // Заявка поставщику, по которой создан приход, закрывается. Остаток уже прибавлен,
  // поэтому сбой здесь не откатывает приход, а только попадает в журнал.
  if (doc.requestId)
    await closeRequestByReceipt(ctx, doc.requestId, id, now).catch((e) =>
      console.error(`[stock] заявка не закрыта приходом: ${String(e)}`),
    );
  return finished ?? doc;
}
