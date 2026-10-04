import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Отпечаток заказов магазина для живого обновления админки без Realtime
 * (схема не меняется, публикацию Supabase не трогаем): время последнего
 * изменения (`updated_at` ведёт триггер `trg_orders_touch`) и число заказов —
 * удаление тоже меняет отпечаток. Страница спрашивает его раз в несколько
 * секунд и перечитывает данные, только когда он изменился.
 */
export type OrdersStamp = { latest: string | null; count: number };

export async function ordersStamp(ctx: TenantContext): Promise<OrdersStamp> {
  const [last, all] = await Promise.all([
    ctx.db.from("orders").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    ctx.db.from("orders").select("id", { count: "exact", head: true }),
  ]);
  const error = last.error ?? all.error;
  if (error) throw serverFailure(`orders stamp: ${error.message}`);
  const row = (last.data ?? [])[0] as { updated_at: string } | undefined;
  return { latest: row?.updated_at ?? null, count: all.count ?? 0 };
}

export function stampKey(s: OrdersStamp): string {
  return `${s.count}:${s.latest ?? ""}`;
}

/** Первый ответ только запоминается: данные страницы уже свежие из загрузчика. */
export function shouldRefresh(prev: string | null, next: string): boolean {
  return prev !== null && prev !== next;
}
