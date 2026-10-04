import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordAutoMessage } from "@/core/automsg/stats";
import { customerFromRow, setState, type Customer } from "@/core/customers/customers";

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
    if (error) throw new Error(`waitlist: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows.map(customerFromRow));
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1]!.user_key;
  }
}

const PAGE = 1000;

export async function countWaiting(ctx: TenantContext, productId: string): Promise<number> {
  const { count } = await ctx.db
    .from("bot_users")
    .select("user_key", { count: "exact", head: true })
    .contains("state", { waitlist: [productId] });
  return count ?? 0;
}

export type WaitlistSender = (customer: Customer) => Promise<boolean>;

/**
 * Разослать ждущим. Товар убирается из списка у всех, кому ушло сообщение;
 * у кого не ушло — остаётся: повторим при следующем возврате в продажу.
 */
export async function notifyWaitlist(
  ctx: TenantContext,
  productId: string,
  send: WaitlistSender,
): Promise<{ notified: number; failed: number }> {
  const r = { notified: 0, failed: 0 };
  for (const c of await waitingCustomers(ctx, productId)) {
    let ok = false;
    try {
      ok = await send(c);
    } catch {
      ok = false;
    }
    await recordAutoMessage(ctx, "waitlist", c.telegramId, ok);
    if (!ok) {
      r.failed++;
      continue;
    }
    r.notified++;
    await setState(ctx, c, { ...c.state, waitlist: withoutWaitlist(c.state.waitlist, productId) });
  }
  return r;
}
