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
import { toCsv } from "@/core/export/csv";
import { listLowStock } from "@/core/catalog/low-stock";
import type { Locale } from "@/core/i18n/locale";
import { adminT } from "@/app/i18n/admin";
import { FORECAST_WARN_DAYS, daysLeft, soldByProduct, stockedProducts } from "./forecast";
import { loadSuppliers, productSuppliers, type Supplier } from "./suppliers";

/**
 * Заявка поставщику. Документ — строка `app_settings` `stock:request:<id>`
 * (схема не меняется), номер — счётчик `stock:request_seq`. Заявку сами не
 * отправляем: продавец копирует текст или скачивает CSV. Жизнь:
 *
 *   draft → ordered → received      (received — закрыл приход, см. closeRequestByReceipt)
 *   draft → deleted                 (удалить можно только черновик)
 *
 * Состав — «заканчивается» (остаток на пороге или ниже) и прогноз «хватит
 * меньше недели» (forecast.ts). Предложенное количество — на 30 дней продаж
 * (или двойной порог, что больше) минус остаток. Группы — по основному
 * поставщику товара; товары без поставщика — отдельная группа (supplierId
 * null). Товар, уже стоящий в черновике или «заказанной» заявке, в
 * предложение не попадает: дважды заказывать то же незачем.
 *
 * Все записи условные по метке (updateSettingStamped): две вкладки или два
 * сотрудника не затирают друг друга, повторное «заказано» ничего не меняет.
 */
export const REQUEST_PREFIX = "stock:request:";
export const REQUEST_SEQ_KEY = "stock:request_seq";
export const REQUEST_MAX_LINES = 200;
export const REQUEST_MAX_QTY = 1_000_000;
/** Хватает ли на столько дней продаж — столько и предлагаем заказать. */
export const REQUEST_COVER_DAYS = 30;

export const requestKey = (id: string) => `${REQUEST_PREFIX}${id}`;

export type RequestStatus = "draft" | "ordered" | "received" | "deleted";
const STATUSES: readonly RequestStatus[] = ["draft", "ordered", "received", "deleted"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestLine = { productId: string; name: string; qty: number };

export type SupplierRequest = {
  id: string;
  no: number;
  /** null — товары без поставщика. */
  supplierId: string | null;
  lines: RequestLine[];
  status: RequestStatus;
  createdAt: string;
  createdBy: string;
  orderedAt: string | null;
  receivedAt: string | null;
  /** Приход, закрывший заявку. */
  receiptId: string | null;
};

export function parseRequest(raw: string | null | undefined): SupplierRequest | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<SupplierRequest> | null;
    if (!j || typeof j !== "object") return null;
    if (typeof j.id !== "string" || !UUID.test(j.id)) return null;
    if (!Number.isInteger(j.no) || !STATUSES.includes(j.status as RequestStatus)) return null;
    if (!Array.isArray(j.lines)) return null;
    return {
      id: j.id,
      no: j.no as number,
      supplierId: typeof j.supplierId === "string" ? j.supplierId : null,
      lines: j.lines as RequestLine[],
      status: j.status as RequestStatus,
      createdAt: String(j.createdAt ?? ""),
      createdBy: String(j.createdBy ?? "system"),
      orderedAt: typeof j.orderedAt === "string" ? j.orderedAt : null,
      receivedAt: typeof j.receivedAt === "string" ? j.receivedAt : null,
      receiptId: typeof j.receiptId === "string" ? j.receiptId : null,
    };
  } catch {
    return null;
  }
}

/* ---------- Предложение: что заказать ---------- */

export type SuggestLine = {
  productId: string;
  name: string;
  stock: number;
  /** Сколько предлагаем заказать. */
  qty: number;
  /** Почему в списке: на пороге, по прогнозу или по обеим причинам. */
  reason: "low" | "forecast" | "both";
  /** Дней хватит (по продажам за 30 дней); null — продаж не было. */
  days: number | null;
};
export type SuggestGroup = { supplierId: string | null; lines: SuggestLine[] };

/** Чистая часть: предложенное количество. */
export function suggestQty(stock: number, sold30: number, threshold: number): number {
  const target = Math.max(Math.ceil((sold30 * REQUEST_COVER_DAYS) / 30), threshold * 2);
  return Math.min(Math.max(target - stock, 1), REQUEST_MAX_QTY);
}

type Low = { id: string; name: string; stock: number; threshold: number };
type Stocked = { id: string; name: string; stock: number | null };

/** Чистая часть: группы по поставщикам из «заканчивается» и прогноза. */
export function buildSuggestions(inp: {
  low: readonly Low[];
  products: readonly Stocked[];
  sold: ReadonlyMap<string, number>;
  supplierOf: ReadonlyMap<string, string>;
  /** Товары, уже стоящие в открытых заявках. */
  skip: ReadonlySet<string>;
}): SuggestGroup[] {
  const lines = new Map<string, SuggestLine>();
  for (const l of inp.low) {
    const sold = inp.sold.get(l.id) ?? 0;
    lines.set(l.id, {
      productId: l.id,
      name: l.name,
      stock: l.stock,
      qty: suggestQty(l.stock, sold, l.threshold),
      reason: "low",
      days: daysLeft(l.stock, sold),
    });
  }
  for (const p of inp.products) {
    if (p.stock === null) continue;
    const sold = inp.sold.get(p.id) ?? 0;
    const d = daysLeft(p.stock, sold);
    if (d === null || d >= FORECAST_WARN_DAYS) continue;
    const prev = lines.get(p.id);
    if (prev) prev.reason = "both";
    else
      lines.set(p.id, {
        productId: p.id,
        name: p.name,
        stock: p.stock,
        qty: suggestQty(p.stock, sold, 0),
        reason: "forecast",
        days: d,
      });
  }
  const groups = new Map<string | null, SuggestLine[]>();
  for (const l of lines.values()) {
    if (inp.skip.has(l.productId)) continue;
    const sid = inp.supplierOf.get(l.productId) ?? null;
    groups.set(sid, [...(groups.get(sid) ?? []), l]);
  }
  return (
    [...groups.entries()]
      .map(([supplierId, ls]) => ({
        supplierId,
        lines: ls.sort(
          (a, b) =>
            (a.days ?? 1e9) - (b.days ?? 1e9) ||
            a.name.localeCompare(b.name) ||
            a.productId.localeCompare(b.productId),
        ),
      }))
      // Группа «без поставщика» — последней; остальные по порядку первого товара.
      .sort((a, b) => Number(a.supplierId === null) - Number(b.supplierId === null))
  );
}

export async function suggestRequests(
  ctx: TenantContext,
  now = new Date(),
): Promise<SuggestGroup[]> {
  const [low, products, sold, supplierOf, open] = await Promise.all([
    listLowStock(ctx),
    stockedProducts(ctx),
    soldByProduct(ctx, now),
    productSuppliers(ctx),
    listRequests(ctx),
  ]);
  const skip = new Set<string>();
  for (const r of open)
    if (r.status === "draft" || r.status === "ordered")
      for (const l of r.lines) skip.add(l.productId);
  return buildSuggestions({ low, products, sold, supplierOf, skip });
}

/* ---------- Документ ---------- */

async function nextNumber(ctx: TenantContext): Promise<number> {
  let no = 0;
  const r = await updateSettingAtomic(ctx, REQUEST_SEQ_KEY, (raw) => {
    const n = Number(raw);
    no = (Number.isInteger(n) && n >= 0 ? n : 0) + 1;
    return String(no);
  });
  if (r !== "written") throw serverFailure("Номер заявки не выдан");
  return no;
}

export type RequestInput = {
  supplierId: string | null;
  lines: Array<{ productId: string; qty: number }>;
};

/** Проверка и названия по базе: товары существуют, количества целые, без повторов. */
async function checkLines(ctx: TenantContext, input: RequestInput): Promise<RequestLine[]> {
  if (input.lines.length === 0)
    throw new UserError("err.stock.requestEmpty", "Добавьте в заявку хотя бы одну позицию.");
  if (input.lines.length > REQUEST_MAX_LINES)
    throw new UserError("err.stock.requestTooBig", "В заявке не больше {max} позиций.", {
      max: REQUEST_MAX_LINES,
    });
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!UUID.test(l.productId))
      throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    if (seen.has(l.productId))
      throw new UserError("err.stock.receiptDuplicate", "Одна и та же позиция указана дважды.");
    seen.add(l.productId);
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > REQUEST_MAX_QTY)
      throw new UserError("err.stock.badQty", "Количество — целое число от 1 до {max}.", {
        max: REQUEST_MAX_QTY,
      });
  }
  if (input.supplierId !== null) {
    const known = (await loadSuppliers(ctx)).items.some((s) => s.id === input.supplierId);
    if (!known)
      throw new UserError(
        "err.stock.supplierNotFound",
        "Такого поставщика нет — возможно, его уже удалили.",
      );
  }
  const names = new Map<string, string>();
  const ids = [...seen];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await ctx.db
      .from("products")
      .select("id, name")
      .in("id", ids.slice(i, i + 200));
    if (error) throw serverFailure(`Товары для заявки: ${error.message}`);
    for (const p of data ?? []) names.set(p.id, p.name);
  }
  return input.lines.map((l) => {
    const name = names.get(l.productId);
    if (name === undefined) throw new UserError("err.stock.receiptProduct", "Товар не найден.");
    return { productId: l.productId, name, qty: l.qty };
  });
}

export async function createRequest(
  ctx: TenantContext,
  input: RequestInput,
  actor: string,
  now = new Date(),
): Promise<SupplierRequest> {
  const lines = await checkLines(ctx, input);
  const no = await nextNumber(ctx);
  const doc: SupplierRequest = {
    id: randomUUID(),
    no,
    supplierId: input.supplierId,
    lines,
    status: "draft",
    createdAt: now.toISOString(),
    createdBy: actor,
    orderedAt: null,
    receivedAt: null,
    receiptId: null,
  };
  const r = await updateSettingStamped(ctx, requestKey(doc.id), (raw) =>
    raw == null ? JSON.stringify(doc) : null,
  );
  if (r !== "written") throw serverFailure("Заявка не сохранилась");
  return doc;
}

/**
 * Условная смена заявки: `from` — статусы, из которых можно; иначе отказ с
 * понятным сообщением. Повтор того же перехода — «уже так», без побочных эффектов.
 */
async function transition(
  ctx: TenantContext,
  id: string,
  from: readonly RequestStatus[],
  change: (d: SupplierRequest) => SupplierRequest,
): Promise<SupplierRequest> {
  let result: SupplierRequest | null = null;
  let seen: RequestStatus | null = null;
  const r = await updateSettingStamped(ctx, requestKey(id), (raw) => {
    const d = parseRequest(raw);
    if (!d || d.status === "deleted") return null;
    seen = d.status;
    if (!from.includes(d.status)) return null;
    result = change(d);
    return JSON.stringify(result);
  });
  if (r === "failed") throw serverFailure("Заявка не сохранилась");
  if (r === "skipped" || !result) {
    if (seen === null) throw new UserError("err.stock.requestNotFound", "Заявка не найдена.");
    throw new UserError(
      "err.stock.requestState",
      "Заявка уже изменилась (обновите страницу): в этом состоянии так менять нельзя.",
    );
  }
  return result;
}

/** Правка состава — только черновика. */
export async function updateRequest(
  ctx: TenantContext,
  id: string,
  input: RequestInput,
): Promise<SupplierRequest> {
  const lines = await checkLines(ctx, input);
  return transition(ctx, id, ["draft"], (d) => ({ ...d, supplierId: input.supplierId, lines }));
}

export async function deleteRequest(ctx: TenantContext, id: string): Promise<void> {
  await transition(ctx, id, ["draft"], (d) => ({ ...d, status: "deleted" }));
}

/** «Заказано»: draft → ordered. Повторно — отказ, дата первого заказа не затирается. */
export async function markOrdered(
  ctx: TenantContext,
  id: string,
  now = new Date(),
): Promise<SupplierRequest> {
  return transition(ctx, id, ["draft"], (d) => ({
    ...d,
    status: "ordered",
    orderedAt: now.toISOString(),
  }));
}

/**
 * Приход проведён — закрыть заявку, по которой он создан. Идемпотентна: уже
 * закрытая или удалённая заявка остаётся как есть (false). Ошибка не бросается
 * наружу вызывающим кодом прихода — остаток уже прибавлен.
 */
export async function closeRequestByReceipt(
  ctx: TenantContext,
  requestId: string,
  receiptId: string,
  now = new Date(),
): Promise<boolean> {
  if (!UUID.test(requestId)) return false;
  let closed = false;
  const r = await updateSettingStamped(ctx, requestKey(requestId), (raw) => {
    const d = parseRequest(raw);
    if (!d || d.status === "deleted" || d.status === "received") return null;
    closed = true;
    return JSON.stringify({
      ...d,
      status: "received",
      receivedAt: now.toISOString(),
      receiptId,
    } satisfies SupplierRequest);
  });
  if (r === "failed") throw serverFailure("Заявка не закрылась");
  return r === "written" && closed;
}

export async function loadRequest(ctx: TenantContext, id: string): Promise<SupplierRequest | null> {
  if (!UUID.test(id)) return null;
  const d = parseRequest(await getSettingStrict(ctx, requestKey(id)));
  return d && d.status !== "deleted" ? d : null;
}

/** Все заявки, свежие сверху; постранично, без обрезки. */
export async function listRequests(ctx: TenantContext): Promise<SupplierRequest[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${REQUEST_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Заявки поставщикам не прочитались",
  );
  const out: SupplierRequest[] = [];
  for (const r of rows) {
    const d = parseRequest(r.value);
    if (d && d.status !== "deleted" && r.key === requestKey(d.id)) out.push(d);
  }
  return out.sort((a, b) => b.no - a.no);
}

/* ---------- Текст и CSV ---------- */

/** Текст для мессенджера: поставщику его отправляет сам продавец. Язык — продавца. */
export function requestText(
  req: SupplierRequest,
  supplier: Pick<Supplier, "name" | "contact"> | null,
  locale: Locale,
): string {
  const t = adminT(locale);
  const head = supplier
    ? t("request.text.hello", { name: supplier.contact || supplier.name })
    : t("request.text.helloAny");
  return [
    head,
    t("request.text.intro"),
    ...req.lines.map((l) => `• ${l.name} — ${l.qty} ${t("request.text.unit")}`),
    t("request.text.thanks"),
  ].join("\n");
}

export function requestCsv(req: SupplierRequest, locale: Locale): string {
  const t = adminT(locale);
  return toCsv(
    [t("request.csv.no"), t("request.csv.name"), t("request.csv.qty")],
    req.lines.map((l, i) => [i + 1, l.name, l.qty]),
  );
}
