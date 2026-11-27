import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer, DialogState } from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";

/** «Передал ваш вопрос продавцу» — не чаще раза в час на покупателя. */
export const FORWARD_WINDOW_MS = 3600_000;

/**
 * Забрать отметку «передал продавцу» (direct.forwarded_at) для этого
 * сообщения — до ответа покупателю и уведомления продавцу. Состояние
 * перечитывается из базы, запись условная: в фильтре только сама отметка и
 * state->>mode, не весь state (431 на большом jsonb). Из двух сообщений
 * подряд отметку получает одно — продавцу уходит одно уведомление, покупателю
 * один ответ. null — в этот час уже передавали или отметку забрало соседнее.
 */
export async function claimForwarded(
  ctx: TenantContext,
  customer: Customer,
  now: Date = new Date(),
): Promise<Customer | null> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("user_key", customer.userKey)
    .maybeSingle();
  if (error) throw serverFailure(`отметка «передал продавцу» не прочитана: ${error.message}`);
  const state = (data?.state ?? customer.state ?? {}) as DialogState;
  const raw = state.direct;
  const direct =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prev = typeof direct.forwarded_at === "string" ? direct.forwarded_at : null;
  const at = Date.parse(prev ?? "");
  if (Number.isFinite(at) && now.getTime() - at < FORWARD_WINDOW_MS) return null;
  const next = { ...state, direct: { ...direct, forwarded_at: now.toISOString() } } as DialogState;
  let q = ctx.db
    .from("bot_users")
    .update({ state: next as Json })
    .eq("user_key", customer.userKey);
  q =
    prev === null
      ? q.is("state->direct->>forwarded_at", null)
      : q.eq("state->direct->>forwarded_at", prev);
  const mode = state.mode;
  q = typeof mode === "string" && mode ? q.eq("state->>mode", mode) : q.is("state->>mode", null);
  const r = await q.select("user_key");
  if (r.error) throw serverFailure(`отметка «передал продавцу» не записана: ${r.error.message}`);
  return r.data?.length ? { ...customer, state: next } : null;
}
