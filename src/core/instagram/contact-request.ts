import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer, DialogState } from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";
import { contactRequested } from "./ice-breakers";

/**
 * Забрать метку «Связаться с продавцом» (direct.contact_requested_at) для
 * этого сообщения. Состояние перечитывается из базы, запись — условная: в
 * фильтре только сама метка и state->>mode, не весь state (431 на большом
 * jsonb). Из двух сообщений подряд метку получает одно — продавцу уходит
 * одна пересылка. null — метки нет или её уже забрало другое сообщение.
 */
export async function claimContactRequest(
  ctx: TenantContext,
  customer: Customer,
): Promise<Customer | null> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("user_key", customer.userKey)
    .maybeSingle();
  if (error) throw serverFailure(`метка «Связаться» не прочитана: ${error.message}`);
  const state = (data?.state ?? {}) as DialogState;
  if (!contactRequested(state)) return null;
  const direct = state.direct as Record<string, unknown>;
  const at = String(direct.contact_requested_at);
  const rest = { ...direct };
  delete rest.contact_requested_at;
  const next = { ...state, direct: rest } as DialogState;
  const q = ctx.db
    .from("bot_users")
    .update({ state: next as Json })
    .eq("user_key", customer.userKey)
    .eq("state->direct->>contact_requested_at", at);
  const mode = state.mode;
  const r = await (
    typeof mode === "string" && mode ? q.eq("state->>mode", mode) : q.is("state->>mode", null)
  ).select("user_key");
  if (r.error) throw serverFailure(`метка «Связаться» не снята: ${r.error.message}`);
  return r.data?.length ? { ...customer, state: next } : null;
}
