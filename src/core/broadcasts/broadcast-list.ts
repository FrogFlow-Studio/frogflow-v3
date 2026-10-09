import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ACTIVE_SCAN, type BroadcastChannel, type BroadcastRow } from "./broadcast-model";
import { isDue } from "./broadcast-batch";

/** Отмена и список рассылок. */

export async function cancelBroadcast(ctx: TenantContext, id: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["queued", "sending"])
    .select("id")
    .maybeSingle();
  if (error) throw serverFailure(`Рассылки: отмена: ${error.message}`);
  if (!data) return false;
  const rest = await ctx.db
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: "cancelled" })
    .eq("broadcast_id", id)
    .eq("status", "pending");
  if (rest.error) throw serverFailure(`Рассылки: получатели отменённой: ${rest.error.message}`);
  return true;
}

/** Размер страницы истории рассылок. */
export const BROADCASTS_PAGE = 50;

/**
 * Страница истории рассылок: новые сверху, порядок заканчивается `id`, чтобы
 * рассылки с одинаковым `created_at` не терялись и не двоились между страницами.
 * `total` — сколько всего, чтобы «Показать ещё» знало, есть ли что показывать.
 */
export async function listBroadcasts(
  ctx: TenantContext,
  offset = 0,
  size = BROADCASTS_PAGE,
): Promise<{ rows: BroadcastRow[]; total: number }> {
  const { data, count, error } = await ctx.db
    .from("broadcasts")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + size - 1);
  if (error) throw serverFailure(`Рассылки: список: ${error.message}`);
  const rows = data ?? [];
  return { rows, total: count ?? offset + rows.length };
}

export async function hasActiveBroadcast(
  ctx: TenantContext,
  channel: BroadcastChannel = "telegram",
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .select("id, audience_filter")
    .in("status", ["queued", "sending"])
    .eq("channel", channel)
    .limit(ACTIVE_SCAN);
  if (error) throw serverFailure(`Рассылки: активные: ${error.message}`);
  const now = Date.now();
  return (data ?? []).some((b) => isDue(b, now));
}
