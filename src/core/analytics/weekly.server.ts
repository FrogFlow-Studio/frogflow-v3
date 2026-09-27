/**
 * Недельный отчёт: собрать итоги прошлой недели и отправить один раз.
 * Канал отправки передаёт вызывающий (крон — бот магазина), ядро канала не знает.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage, pageAll } from "@/core/db/page";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import { buyerFunnel } from "./funnel.server";
import {
  analyticsRevenue,
  includeOrderInAnalytics,
  topProductsBySales,
  type AnalyticsItem,
} from "./pure";
import {
  renderWeekly,
  weeklyEnabled,
  weekWindow,
  WEEKLY_ENABLED_KEY,
  WEEKLY_SENT_KEY,
  type WeekWindow,
  type WeeklyStats,
} from "./weekly";

type Money = { revenue: number; orders: number; ids: number[]; scale: Map<number, number> };

export async function weeklyStats(ctx: TenantContext, w: WeekWindow): Promise<WeeklyStats> {
  const cur = new Map<string, Money>();
  const prev = new Map<string, Money>();
  const blank = (): Money => ({ revenue: 0, orders: 0, ids: [], scale: new Map() });
  const fromIso = w.from.toISOString();
  await eachPage(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, created_at, total, paid_amount, currency, status, fulfillment_kind")
        .gte("created_at", w.prevFrom.toISOString())
        .lt("created_at", w.to.toISOString())
        .order("created_at")
        .order("id")
        .range(a, b),
    "заказы для недельного отчёта",
    (rows) => {
      for (const o of rows) {
        if (!includeOrderInAnalytics(o)) continue;
        const map = new Date(o.created_at).toISOString() >= fromIso ? cur : prev;
        const c = o.currency || "—";
        const m = map.get(c) ?? blank();
        map.set(c, m);
        const revenue = analyticsRevenue(o);
        m.revenue += revenue;
        m.orders += 1;
        m.ids.push(o.id);
        const total = Number(o.total) || 0;
        if (total > 0 && revenue !== total) m.scale.set(o.id, revenue / total);
      }
    },
  );
  // Основная валюта — с наибольшим числом оплаченных заказов за неделю.
  let currency = "KZT";
  let best = -1;
  for (const [c, m] of cur)
    if (m.orders > best) {
      currency = c;
      best = m.orders;
    }
  if (best < 0) currency = (await getSetting(ctx, "currency"))?.toUpperCase() || "KZT";
  const main = cur.get(currency) ?? blank();
  const before = prev.get(currency) ?? blank();

  const items: AnalyticsItem[] = [];
  for (let i = 0; i < main.ids.length; i += 200) {
    const chunk = main.ids.slice(i, i + 200);
    items.push(
      ...(await pageAll(
        (a, b) =>
          ctx.db
            .from("order_items")
            .select("order_id, product_id, name_snapshot, price_snapshot, quantity")
            .in("order_id", chunk)
            .order("order_id")
            .order("id")
            .range(a, b),
        "позиции заказов для недельного отчёта",
      )),
    );
  }
  const top = topProductsBySales(items, new Set(main.ids), 3, main.scale);
  return {
    currency,
    revenue: Math.round(main.revenue),
    orders: main.orders,
    prevRevenue: Math.round(before.revenue),
    prevOrders: before.orders,
    funnel: await buyerFunnel(ctx, w.from, w.to),
    top: top.map((p) => ({ name: p.name, qty: p.qty })),
  };
}

export type WeeklyOutcome = "off" | "notDue" | "already" | "sent" | "failed";

/**
 * Отправить отчёт за прошлую неделю, если пора и ещё не отправлен.
 * Неделю отмечаем атомарно (сравнение с прежним значением) до отправки:
 * два одновременных прогона крона — отправит только один. Выключен в
 * настройках — ничего не считаем и не пишем.
 */
export async function sendWeeklyReport(
  ctx: TenantContext,
  send: (html: string) => Promise<unknown>,
  now = new Date(),
): Promise<WeeklyOutcome> {
  if (!weeklyEnabled(await getSetting(ctx, WEEKLY_ENABLED_KEY))) return "off";
  const w = weekWindow(now, ctx.timezone);
  if (!w.due) return "notDue";
  if ((await getSetting(ctx, WEEKLY_SENT_KEY)) === w.week) return "already";
  const stats = await weeklyStats(ctx, w);
  const claim = await updateSettingAtomic(ctx, WEEKLY_SENT_KEY, (raw) =>
    raw === w.week ? null : w.week,
  );
  if (claim === "skipped") return "already";
  if (claim === "failed") return "failed";
  await send(renderWeekly(w.label, stats));
  return "sent";
}
