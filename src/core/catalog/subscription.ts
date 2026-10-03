import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { getSetting, setSetting } from "@/core/settings/settings";
import { daytime } from "@/core/winback/winback";
import type { Customer } from "@/core/customers/customers";
import type { OrderWithItems } from "@/core/orders/orders";

/**
 * Товары-подписки (модуль `subscriptions`): товар, который покупают раз в
 * N дней, — ежемесячный набор, коробка, клуб. Период — строка app_settings
 * `product_subscription:<id товара>` = {"days": N}; своей колонки нет.
 * Автосписания нет (шлюзы продавцов его не дают): через N дней после
 * оплаченного заказа покупатель получает напоминание «продлить» — в
 * Telegram кнопкой (товар сразу в корзину и оформление), в Direct и на
 * сайте — ссылкой на товар. Отказ — `bot_users.state.sub_off` (список id
 * товаров). Напоминание — одно на исходный заказ (событие
 * `subscription_renewal` с ключом товара): повторный крон его не шлёт.
 */
export const SUBSCRIPTION_PREFIX = "product_subscription:";
export const MIN_DAYS = 7;
export const MAX_DAYS = 365;
/** Сколько дней после срока ещё напоминаем: крон пропустил сутки — не страшно, год спустя — поздно. */
export const CATCH_UP_DAYS = 5;
export const RENEWAL_BATCH = 50;

/** Заказ оплачен и продлевает подписку: цифровой выдан или оплачен, физический принят. */
const PAID_STATUSES = ["paid", "delivered", "accepted", "in_production", "ready"] as const;

export function parseSubscriptionDays(raw: string | null | undefined): number | null {
  try {
    const d = Number((JSON.parse(raw ?? "null") as { days?: unknown } | null)?.days);
    return Number.isInteger(d) && d >= MIN_DAYS && d <= MAX_DAYS ? d : null;
  } catch {
    return null;
  }
}

export async function loadSubscriptionDays(
  ctx: TenantContext,
  productId: string,
): Promise<number | null> {
  return parseSubscriptionDays(await getSetting(ctx, `${SUBSCRIPTION_PREFIX}${productId}`));
}

/** null или 0 — товар больше не подписка. */
export async function saveSubscriptionDays(
  ctx: TenantContext,
  productId: string,
  days: number | null,
): Promise<number | null> {
  const clean = days ? parseSubscriptionDays(JSON.stringify({ days })) : null;
  await setSetting(
    ctx,
    `${SUBSCRIPTION_PREFIX}${productId}`,
    clean ? JSON.stringify({ days: clean }) : "",
  );
  return clean;
}

/** Все товары-подписки магазина: id → период в днях. */
export async function listSubscriptionProducts(ctx: TenantContext): Promise<Map<string, number>> {
  const { data, error: dataError } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", ctx.tenant.id)
    .like("key", `${SUBSCRIPTION_PREFIX}%`)
    .limit(1000);
  if (dataError) throw serverFailure(`Подписка на товар: ${dataError.message}`);
  const out = new Map<string, number>();
  for (const r of data ?? []) {
    const days = parseSubscriptionDays(r.value);
    if (days) out.set(r.key.slice(SUBSCRIPTION_PREFIX.length), days);
  }
  return out;
}

export function subscriptionOff(c: Pick<Customer, "state"> | null, productId: string): boolean {
  const off = c?.state.sub_off;
  return Array.isArray(off) && off.includes(productId);
}

/** Отказ покупателя от подписки на товар (или возврат к ней). */
export function withSubscriptionOff(
  state: Customer["state"],
  productId: string,
  off: boolean,
): Customer["state"] {
  const cur = Array.isArray(state.sub_off)
    ? state.sub_off.filter((x): x is string => typeof x === "string")
    : [];
  const next = off
    ? Array.from(new Set([...cur, productId])).slice(-50)
    : cur.filter((x) => x !== productId);
  return { ...state, sub_off: next as unknown as Json };
}

export type Renewal = {
  order: OrderWithItems;
  productId: string;
  variantId: string | null;
  name: string;
  days: number;
};

export type RenewalSender = (r: Renewal, customer: Customer | null) => Promise<boolean>;

/**
 * Напоминания о продлении: для каждого товара-подписки — оплаченные заказы,
 * которым исполнилось N дней (с запасом CATCH_UP_DAYS), без более нового
 * заказа того же покупателя с этим товаром и без отказа покупателя.
 */
export async function runSubscriptionRenewals(
  ctx: TenantContext,
  send: RenewalSender,
  now = new Date(),
): Promise<{ sent: number; failed: number; skipped?: string }> {
  const r = { sent: 0, failed: 0 };
  if (!ctx.tenant.modules.subscriptions) return { ...r, skipped: "module off" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const products = await listSubscriptionProducts(ctx);
  if (products.size === 0) return { ...r, skipped: "no products" };
  const { getCustomerByTelegramId, isBlocked } = await import("@/core/customers/customers");
  const { claimOrderEvent } = await import("@/core/orders/events");
  const maxDays = Math.max(...products.values());
  const minDays = Math.min(...products.values());
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .in("status", [...PAID_STATUSES])
    .gte(
      "created_at",
      new Date(now.getTime() - (maxDays + CATCH_UP_DAYS) * 86400_000).toISOString(),
    )
    .lte("created_at", new Date(now.getTime() - minDays * 86400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (dataError) throw serverFailure(`Подписка на товар: ${dataError.message}`);
  const orders = (data ?? []) as unknown as OrderWithItems[];
  // Самый свежий заказ покупателя с товаром — только он продлевается.
  const seen = new Set<string>();
  for (const order of orders) {
    if (r.sent + r.failed >= RENEWAL_BATCH) break;
    for (const item of order.order_items ?? []) {
      const pid = item.product_id;
      const days = pid ? products.get(pid) : undefined;
      if (!pid || !days) continue;
      const who = `${order.telegram_id}:${pid}`;
      if (seen.has(who)) continue;
      seen.add(who);
      const age = (now.getTime() - new Date(order.created_at).getTime()) / 86400_000;
      if (age < days || age > days + CATCH_UP_DAYS) continue;
      if (await renewedSince(ctx, order, pid)) continue;
      const tg = Number(order.telegram_id);
      const customer = await getCustomerByTelegramId(ctx, tg);
      if (subscriptionOff(customer, pid)) continue;
      // Отписка от рассылок не отменяет подписку на товар: это напоминание о покупке.
      if (await isBlocked(ctx, tg)) continue;
      // Сначала отметка: второй запуск крона в тот же час не напомнит дважды.
      if (!(await claimOrderEvent(ctx, order.id, "subscription_renewal", pid, { productId: pid })))
        continue;
      const ok = await send(
        {
          order,
          productId: pid,
          variantId: item.product_variant_id ?? null,
          name: item.name_snapshot,
          days,
        },
        customer,
      ).catch(() => false);
      if (ok) r.sent++;
      else r.failed++;
    }
  }
  return r;
}

/** Покупатель уже заказал товар снова (любым заказом, кроме отменённых). */
async function renewedSince(
  ctx: TenantContext,
  order: OrderWithItems,
  productId: string,
): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .select("id, status, order_items(product_id)")
    .eq("telegram_id", order.telegram_id)
    .gt("created_at", order.created_at)
    .limit(50);
  if (dataError) throw serverFailure(`Подписка на товар: ${dataError.message}`);
  return (data ?? []).some(
    (o) =>
      !["rejected", "cancelled"].includes(o.status) &&
      (o.order_items as Array<{ product_id: string | null }> | null)?.some(
        (i) => i.product_id === productId,
      ),
  );
}

/** Текст напоминания: что продлить и через сколько дней оно кончилось. */
export function renewalText(name: string, days: number, how: string | null): string {
  return [`🔁 Пора продлить подписку «${name}» — прошло ${days} дн. с прошлой оплаты.`, how]
    .filter(Boolean)
    .join("\n");
}
