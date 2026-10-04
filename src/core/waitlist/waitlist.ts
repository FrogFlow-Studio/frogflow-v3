import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordAutoMessage } from "@/core/automsg/stats";
import type { Json } from "@/core/db-types";
import {
  blockedAmong,
  customerFromRow,
  setState,
  stateFromJson,
  type Customer,
} from "@/core/customers/customers";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { getSettingsStrict, trySetSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";

/**
 * Лист ожидания (модуль waitlist): покупатель нажимает «Сообщить, когда
 * появится» на товаре без остатка — id товара ложится в его
 * `bot_users.state.waitlist`. Когда товар снова в продаже (остаток > 0 или
 * снова включён), каждому ждущему уходит сообщение, товар из его списка
 * убирается. Своей таблицы нет — схема заморожена; выборка по jsonb @>.
 */
export const WAITLIST_MAX = 30;

export function withWaitlist(list: readonly string[] | undefined, id: string): string[] {
  const cur = (list ?? []).filter((x) => x !== id);
  return [id, ...cur].slice(0, WAITLIST_MAX);
}

export function withoutWaitlist(list: readonly string[] | undefined, id: string): string[] {
  return (list ?? []).filter((x) => x !== id);
}

export type StockState = { is_active: boolean; stock_quantity: number | null };

export function inStock(p: StockState): boolean {
  return p.is_active && (p.stock_quantity == null || p.stock_quantity > 0);
}

/** Товар вернулся в продажу: был недоступен — стал доступен. */
export function backInStock(before: StockState | null, after: StockState): boolean {
  return Boolean(before) && !inStock(before!) && inStock(after);
}

export async function joinWaitlist(
  ctx: TenantContext,
  customer: Customer,
  productId: string,
): Promise<Customer> {
  const list = Array.isArray(customer.state.waitlist) ? customer.state.waitlist : [];
  if (list.includes(productId)) return customer;
  return setState(ctx, customer, { ...customer.state, waitlist: withWaitlist(list, productId) });
}

/**
 * Все ждущие товар. Страницы — по user_key после последнего увиденного, а не
 * по смещению: рассылка убирает товар из списка у получивших, и смещение
 * перепрыгнуло бы через ещё не оповещённых.
 */
export async function waitingCustomers(ctx: TenantContext, productId: string): Promise<Customer[]> {
  const out: Customer[] = [];
  let after: string | null = null;
  for (;;) {
    let q = ctx.db
      .from("bot_users")
      .select("*")
      .contains("state", { waitlist: [productId] })
      .order("user_key")
      .limit(PAGE);
    if (after != null) q = q.gt("user_key", after);
    const { data, error } = await q;
    if (error) throw serverFailure(`Лист ожидания: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows.map(customerFromRow));
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1]!.user_key;
  }
}

const PAGE = 1000;

/** Сколько ждут товар. Не прочиталось — ошибка, а не «0». */
export async function countWaiting(ctx: TenantContext, productId: string): Promise<number> {
  const { count, error } = await ctx.db
    .from("bot_users")
    .select("user_key", { count: "exact", head: true })
    .contains("state", { waitlist: [productId] });
  if (error) throw serverFailure(`Лист ожидания: ${error.message}`);
  return count ?? 0;
}

export type WaitlistSender = (customer: Customer) => Promise<boolean>;

/** Итог рассылки по товару. `left` — не дошла очередь: бюджет времени вышел. */
export type WaitlistRun = { notified: number; failed: number; left: number };

/** Общий бюджет рассылки: функция живёт 120 с, одна отправка — до ~12 с. */
export const WAITLIST_BUDGET_MS = 90_000;

/**
 * «Этому покупателю про этот товар сообщаем»: товар убирается из его списка
 * условной записью, и сообщение шлёт только тот, чья запись прошла. Условия —
 * на маленькие поля: товар ещё в списке (`@>`, один id) и тот же `state.mode`;
 * две одновременные рассылки (сохранение карточки и склад) делят покупателей,
 * а не шлют каждому дважды. Состояние перечитывается прямо перед записью.
 */
export async function claimWaitlistNotice(
  ctx: TenantContext,
  customer: Customer,
  productId: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("user_key", customer.userKey)
    .maybeSingle();
  if (error)
    throw serverFailure(`Не удалось прочитать состояние ${customer.userKey}: ${error.message}`);
  if (!data) return false;
  const state = stateFromJson(data.state);
  const list = Array.isArray(state.waitlist) ? state.waitlist : [];
  if (!list.includes(productId)) return false;
  const next = { ...state, waitlist: withoutWaitlist(list, productId) };
  const base = ctx.db
    .from("bot_users")
    .update({ state: next as Json })
    .eq("user_key", customer.userKey)
    .contains("state", { waitlist: [productId] });
  const mode = typeof state.mode === "string" && state.mode ? state.mode : null;
  const { data: written, error: werr } = await (
    mode == null ? base.is("state->>mode", null) : base.eq("state->>mode", mode)
  ).select("user_key");
  if (werr)
    throw serverFailure(`Не удалось сохранить состояние ${customer.userKey}: ${werr.message}`);
  return Boolean(written?.length);
}

/**
 * Разослать ждущим. Сначала запись «сообщаем» (claimWaitlistNotice), потом
 * отправка: товар убран из списка у каждого, кому мы пытались написать, —
 * отправку, которая могла дойти, не повторяем. Instagram и WhatsApp вне окна
 * ответа 24 часа Meta не пропустит: это «не дошло», покупатель не остаётся в
 * вечной очереди. Когда бюджет времени вышел, остаток ждёт следующей
 * рассылки (`left`).
 */
export async function notifyWaitlist(
  ctx: TenantContext,
  productId: string,
  send: WaitlistSender,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<WaitlistRun> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? WAITLIST_BUDGET_MS;
  const r: WaitlistRun = { notified: 0, failed: 0, left: 0 };
  const queue = await waitingCustomers(ctx, productId);
  // Заблокированный продавцом покупатель маркетинг не получает: молча пропускаем,
  // товар остаётся в его списке (разблокируют — получит со следующей рассылкой).
  const blocked = await blockedAmong(
    ctx,
    queue.map((c) => c.telegramId),
  );
  for (let i = 0; i < queue.length; i++) {
    if (clock() - started >= budget) {
      r.left = queue.length - i;
      break;
    }
    const c = queue[i]!;
    if (blocked.has(c.telegramId)) continue;
    const viaZernio = c.platform === "instagram" || c.platform === "whatsapp";
    let windowOpen = true;
    if (viaZernio) {
      try {
        windowOpen =
          replyWindow(c.platform, await lastInboundAt(ctx, c.telegramId), clock())?.state ===
          "open";
      } catch (e) {
        // Окно не прочиталось — покупателя не трогаем, он остаётся в очереди.
        console.error(`[waitlist:${ctx.tenant.id}] ${c.userKey}`, e);
        r.left++;
        continue;
      }
    }
    if (!(await claimWaitlistNotice(ctx, c, productId))) continue;
    let ok = false;
    try {
      ok = windowOpen && (await send(c));
    } catch (e) {
      console.error(`[waitlist:${ctx.tenant.id}] ${c.userKey}`, e);
    }
    await recordAutoMessage(ctx, "waitlist", c.telegramId, ok);
    if (ok) r.notified++;
    else r.failed++;
  }
  if (r.notified + r.failed + r.left > 0) await saveLastRun(ctx, productId, r, clock());
  return r;
}

const LAST_RUN_PREFIX = "waitlist_last:";

export type WaitlistLastRun = WaitlistRun & { at: string };

/** Итог последней рассылки по товару — для карточки товара у продавца. */
async function saveLastRun(ctx: TenantContext, productId: string, r: WaitlistRun, at: number) {
  const value = JSON.stringify({ ...r, at: new Date(at).toISOString() });
  await trySetSetting(ctx, `${LAST_RUN_PREFIX}${productId}`, value);
}

export function parseLastRun(raw: string | undefined): WaitlistLastRun | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WaitlistLastRun>;
    if (
      !Number.isInteger(v.notified) ||
      !Number.isInteger(v.failed) ||
      !Number.isInteger(v.left) ||
      typeof v.at !== "string"
    )
      return null;
    return { notified: v.notified!, failed: v.failed!, left: v.left!, at: v.at };
  } catch {
    return null;
  }
}

export async function lastWaitlistRun(
  ctx: TenantContext,
  productId: string,
): Promise<WaitlistLastRun | null> {
  const key = `${LAST_RUN_PREFIX}${productId}`;
  return parseLastRun((await getSettingsStrict(ctx, [key]))[key]);
}
