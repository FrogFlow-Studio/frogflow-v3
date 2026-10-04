import { serverFailure } from "@/lib/server-failure";
import { awardPointsForOrder } from "@/core/discounts/discounts";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "./orders";
import { serviceDb } from "@/core/db/client.server";
import { eachPage } from "@/core/db/page";
import { isDeliverableStorageKey } from "@/core/storage/keys";
import { isAuditableProofPath, proofPathCandidates } from "@/core/receipts/audit";
import {
  addDaysToIso,
  OPEN_PHYSICAL_STATUSES,
  todayInTz,
  type PickupFilter,
} from "@/core/fulfillment/pure";

export type OrderFilter = {
  status?: string;
  q?: string;
  limit?: number;
  /** «К выдаче»: открытые физические заказы по дню получения (matchesPickupFilter). */
  pickup?: PickupFilter;
  /** «Не доплачено»: задаток внесён, остаток нет (underpaidOrderIds). */
  unpaid?: boolean;
};

/** Статусы, где внесённое уже учтено и остаток ждут: в работе и выданные. */
const UNDERPAID_STATUSES = ["accepted", "in_production", "ready", "delivered"] as const;

/**
 * Заказы «не доплачено»: физические, задаток внесён (paid_amount > 0), но
 * меньше итога; отклонённые и отменённые не считаются. PostgREST не сравнивает
 * две колонки, поэтому кандидатов читаем постранично (порядок заканчивается
 * уникальным id) и сравниваем здесь; копейка округления — не долг. Новые сверху.
 */
export async function underpaidOrderIds(ctx: TenantContext): Promise<number[]> {
  const ids: number[] = [];
  await eachPage<{ id: number; total: number | string; paid_amount: number | string | null }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, total, paid_amount")
        .eq("fulfillment_kind", "physical")
        .in("status", [...UNDERPAID_STATUSES])
        .gt("paid_amount", 0)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "underpaid",
    (rows) => {
      for (const o of rows)
        if (Number(o.total) - (Number(o.paid_amount) || 0) > 0.01) ids.push(o.id);
    },
  );
  return ids;
}

/** Сколько id за раз передаём в «id in (…)»: длина адреса запроса ограничена. */
const UNDERPAID_LIST_MAX = 300;

export async function listOrdersForAdmin(
  ctx: TenantContext,
  f: OrderFilter = {},
): Promise<OrderWithItems[]> {
  let q = ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .limit(f.limit ?? 100);
  if (f.unpaid) {
    const ids = (await underpaidOrderIds(ctx)).slice(0, UNDERPAID_LIST_MAX);
    if (!ids.length) return [];
    q = q.in("id", ids);
  }
  if (f.status) q = q.eq("status", f.status);
  if (f.pickup) {
    // fulfillment_at хранится полночью UTC календарного дня получения.
    const today = todayInTz(ctx.timezone);
    const day = (iso: string) => `${iso}T00:00:00Z`;
    q = q.eq("fulfillment_kind", "physical").in("status", [...OPEN_PHYSICAL_STATUSES]);
    if (f.pickup === "nodate") q = q.is("fulfillment_at", null);
    else if (f.pickup === "overdue") q = q.lt("fulfillment_at", day(today));
    else {
      const from = f.pickup === "today" ? today : addDaysToIso(today, 1);
      q = q.gte("fulfillment_at", day(from)).lt("fulfillment_at", day(addDaysToIso(from, 1)));
    }
    q = q.order("fulfillment_at", { ascending: true });
  }
  q = q.order("created_at", { ascending: false });
  if (f.q?.trim()) {
    const s = f.q.trim().replace(/[%_,()]/g, " ");
    const asNo = Number(s);
    q =
      // До 6 цифр — номер заказа; длиннее — телефон покупателя (номер заказа так не бывает).
      Number.isInteger(asNo) && asNo > 0 && s.length <= 6
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
    "refunded",
  ];
  const out: OrderCounts = {};
  await Promise.all([
    underpaidOrderIds(ctx).then((ids) => {
      out.unpaid = ids.length;
    }),
    ...statuses.map(async (s) => {
      const { count, error: countError } = await ctx.db
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      if (countError) throw serverFailure(`Заказы: ${countError.message}`);
      out[s] = count ?? 0;
    }),
  ]);
  return out;
}

/**
 * Выручка за `days` дней для главной админки — по тем же правилам, что
 * аналитика (core/analytics/pure): выданные заказы и физические в работе с
 * внесённым задатком; сумма — в основной валюте, другие не складываются.
 */
export async function revenue(
  ctx: TenantContext,
  days: number,
): Promise<{ total: number; currency: string; orders: number }> {
  const { analyticsRevenue, dominantCurrency, includeOrderInAnalytics } =
    await import("@/core/analytics/pure");
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { netOfRefunds, refundsSince } = await import("./refund");
  const refunds = await refundsSince(ctx, since);
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .select("id, total, paid_amount, currency, status, fulfillment_kind")
    .in("status", ["delivered", "accepted", "in_production", "ready"])
    .gte("created_at", since);
  if (dataError) throw serverFailure(`Заказы: ${dataError.message}`);
  const counted = (data ?? []).filter((o) => includeOrderInAnalytics(o));
  const currency = dominantCurrency(counted) ?? "KZT";
  let total = 0;
  let orders = 0;
  for (const o of counted)
    if ((o.currency || "—") === currency) {
      total += netOfRefunds(analyticsRevenue(o), refunds.get(o.id));
      orders += 1;
    }
  return { total: Math.round(total), currency, orders };
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
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id, telegram_id, total, currency")
    .maybeSingle();
  if (dataError) throw serverFailure(`Заказы: ${dataError.message}`);
  // Физический заказ выдан — баллы, как за выданный цифровой (deliverOrder).
  // Повторно не начислится: awardPointsForOrder — CAS по points_earned.
  if (data && to === "delivered")
    await awardPointsForOrder(
      ctx,
      id,
      Number(data.telegram_id),
      Number(data.total),
      data.currency,
    ).catch((e) => console.error(`[orders] баллы за заказ #${id}: ${String(e)}`));
  return Boolean(data);
}

/**
 * Какие ключи бакета payment-proofs пробовать для чека заказа. Путь берётся
 * из строки заказа этого клиента, поэтому правило то же, что у выдачи
 * покупателю: свой префикс или старый чек v1 без префикса (как записан, потом
 * в папке клиента — куда его мог перенести v1), но не чужой префикс.
 */
export function proofKeysToTry(tenantId: string, path: string): string[] {
  if (!isAuditableProofPath(path) || !isDeliverableStorageKey(tenantId, path)) return [];
  return proofPathCandidates(path, tenantId).filter((k) => isDeliverableStorageKey(tenantId, k));
}

export async function proofSignedUrl(ctx: TenantContext, path: string): Promise<string | null> {
  for (const key of proofKeysToTry(ctx.tenant.id, path)) {
    const { data } = await serviceDb().storage.from("payment-proofs").createSignedUrl(key, 600);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
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
    const { error } = await ctx.db.from("blocked_users").delete().eq("telegram_id", telegramId);
    if (error) throw serverFailure(`Заказы: разблокировка: ${error.message}`);
  }
}
