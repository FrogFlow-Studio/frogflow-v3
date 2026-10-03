import { serverFailure } from "@/lib/server-failure";
import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { serviceDb } from "@/core/db/client.server";
import { addToCart } from "@/core/cart/cart";

/**
 * Перенос корзины с витрины или Mini App в Telegram: одноразовый токен в
 * web_cart_handoffs (таблица закрыта для tenant_bot — пишем service_role),
 * покупатель открывает t.me/<бот>?start=wc_<токен>, бот забирает позиции в
 * cart_items и показывает корзину. Дальше — обычное оформление в боте.
 */
export const HANDOFF_PREFIX = "wc_";
const TTL_MS = 24 * 3600_000;

export type HandoffItem = {
  product_id: string;
  product_variant_id?: string | null;
  quantity: number;
};

export function parseHandoffItems(raw: unknown): HandoffItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HandoffItem[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const pid = (r as { product_id?: unknown }).product_id;
    if (typeof pid !== "string" || !/^[0-9a-f-]{36}$/i.test(pid)) continue;
    const v = (r as { product_variant_id?: unknown }).product_variant_id;
    const q = Number((r as { quantity?: unknown }).quantity);
    out.push({
      product_id: pid,
      product_variant_id: typeof v === "string" ? v : null,
      quantity: Number.isFinite(q) ? Math.max(1, Math.min(99, Math.floor(q))) : 1,
    });
  }
  return out;
}

export async function createHandoff(
  ctx: TenantContext,
  items: HandoffItem[],
): Promise<{ token: string; url: string } | null> {
  const username = ctx.tenant.settings.telegram?.username;
  if (!username || items.length === 0) return null;
  const token = randomBytes(16).toString("hex");
  const { error } = await serviceDb()
    .from("web_cart_handoffs")
    .insert({
      token,
      bot_id: ctx.tenant.id,
      items: items as never,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    });
  if (error) throw new Error(`handoff: ${error.message}`);
  return { token, url: `https://t.me/${username}?start=${HANDOFF_PREFIX}${token}` };
}

export type ClaimResult = "ok" | "missing" | "expired" | "claimed" | "empty";

export async function claimHandoff(
  ctx: TenantContext,
  customer: Customer,
  token: string,
): Promise<ClaimResult> {
  const t = token.trim();
  if (!/^[0-9a-f]{32}$/.test(t)) return "missing";
  const { data: row, error: rowError } = await serviceDb()
    .from("web_cart_handoffs")
    .select("bot_id, items, expires_at, claimed_at")
    .eq("token", t)
    .maybeSingle();
  if (rowError) throw serverFailure(`Витрина: передача: ${rowError.message}`);
  if (!row || row.bot_id !== ctx.tenant.id) return "missing";
  if (row.claimed_at) return "claimed";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  const imported = await importItems(ctx, customer, parseHandoffItems(row.items));
  if (imported === 0) return "empty";
  const marked = await serviceDb()
    .from("web_cart_handoffs")
    .update({ claimed_at: new Date().toISOString(), claimed_telegram_id: customer.telegramId })
    .eq("token", t)
    .is("claimed_at", null);
  // Позиции уже в корзине: сбой отметки не отменяет импорт, но виден в журнале.
  if (marked.error) console.error("[handoff] отметка не записана", marked.error.message);
  return "ok";
}

/** Позиции в корзину покупателя через те же гварды, что и кнопка в боте. */
export async function importItems(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
): Promise<number> {
  let imported = 0;
  for (const it of items) {
    for (let i = 0; i < it.quantity; i++) {
      const r = await addToCart(ctx, customer, it.product_id, it.product_variant_id ?? null);
      if (r === "ok") imported++;
      else if (r === "digital_limit") {
        imported++;
        break;
      } else break;
    }
  }
  return imported;
}
