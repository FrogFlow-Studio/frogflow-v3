import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "./orders";
import { serviceDb } from "@/core/db/client.server";

export type OrderFilter = { status?: string; q?: string; limit?: number };

export async function listOrdersForAdmin(
  ctx: TenantContext,
  f: OrderFilter = {},
): Promise<OrderWithItems[]> {
  let q = ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false })
    .limit(f.limit ?? 100);
  if (f.status) q = q.eq("status", f.status);
  if (f.q?.trim()) {
    const s = f.q.trim().replace(/[%_,()]/g, " ");
    const asNo = Number(s);
    q =
      Number.isInteger(asNo) && asNo > 0
        ? q.or(`display_no.eq.${asNo},order_no.eq.${asNo},id.eq.${asNo}`)
        : q.or(
            `display_name.ilike.%${s}%,username.ilike.%${s}%,contact.ilike.%${s}%,customer_email.ilike.%${s}%`,
          );
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderWithItems[];
}

export type OrderCounts = Record<string, number>;

export async function orderCounts(ctx: TenantContext): Promise<OrderCounts> {
  const statuses = [
    "awaiting_payment",
    "awaiting_confirmation",
    "delivering",
    "delivered",
    "accepted",
    "in_production",
    "ready",
    "rejected",
  ];
  const out: OrderCounts = {};
  await Promise.all(
    statuses.map(async (s) => {
      const { count } = await ctx.db
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      out[s] = count ?? 0;
    }),
  );
  return out;
}

export async function revenue(
  ctx: TenantContext,
  days: number,
): Promise<{ total: number; currency: string; orders: number }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await ctx.db
    .from("orders")
    .select("total, currency")
    .in("status", ["delivered", "accepted", "in_production", "ready", "completed", "paid"])
    .gte("created_at", since);
  let total = 0;
  let currency = "KZT";
  for (const r of data ?? []) {
    total += Number(r.total) || 0;
    currency = r.currency;
  }
  return { total, currency, orders: data?.length ?? 0 };
}

export async function setOrderNote(
  ctx: TenantContext,
  id: number,
  note: string | null,
): Promise<void> {
  const { error } = await ctx.db.from("orders").update({ admin_note: note }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Статусы физического заказа: accepted → in_production → ready → delivered, шаг назад кроме delivered. */
export const PHYSICAL_NEXT: Record<string, string> = {
  accepted: "in_production",
  in_production: "ready",
  ready: "delivered",
};
export const PHYSICAL_PREV: Record<string, string> = {
  in_production: "accepted",
  ready: "in_production",
};

export async function setPhysicalStatus(
  ctx: TenantContext,
  id: number,
  from: string,
  to: string,
): Promise<boolean> {
  const { data } = await ctx.db
    .from("orders")
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function proofSignedUrl(ctx: TenantContext, path: string): Promise<string | null> {
  if (!path.startsWith(`${ctx.tenant.id}/`)) return null;
  const { data } = await serviceDb().storage.from("payment-proofs").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

export type CustomerRow = {
  user_key: string;
  platform: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_phone: string | null;
  email: string | null;
  loyalty_points: number;
  created_at: string;
  blocked: boolean;
};

export async function listCustomers(
  ctx: TenantContext,
  q?: string,
  limit = 200,
): Promise<CustomerRow[]> {
  let query = ctx.db
    .from("bot_users")
    .select(
      "user_key, platform, telegram_id, username, first_name, last_name, contact_phone, email, loyalty_points, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (q?.trim()) {
    const s = q.trim().replace(/[%_,()]/g, " ");
    query = query.or(
      `username.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,contact_phone.ilike.%${s}%`,
    );
  }
  const [{ data, error }, { data: blocked }] = await Promise.all([
    query,
    ctx.db.from("blocked_users").select("telegram_id"),
  ]);
  if (error) throw new Error(error.message);
  const b = new Set((blocked ?? []).map((r) => Number(r.telegram_id)));
  return (data ?? []).map((r) => ({
    ...r,
    telegram_id: Number(r.telegram_id),
    blocked: b.has(Number(r.telegram_id)),
  }));
}

export async function setBlocked(
  ctx: TenantContext,
  telegramId: number,
  blocked: boolean,
  meta?: { username?: string | null; firstName?: string | null; reason?: string },
): Promise<void> {
  if (blocked) {
    const { error } = await ctx.db.from("blocked_users").upsert({
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      username: meta?.username ?? null,
      first_name: meta?.firstName ?? null,
      reason: meta?.reason ?? null,
    });
    if (error) throw new Error(error.message);
  } else {
    await ctx.db.from("blocked_users").delete().eq("telegram_id", telegramId);
  }
}
