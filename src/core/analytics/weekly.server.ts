/**
 * Недельный отчёт: собрать итоги прошлой недели и отправить один раз.
 * Канал отправки передаёт вызывающий (крон — бот магазина), ядро канала не знает.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage, pageAll } from "@/core/db/page";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import { outboxPermanentFailure } from "@/core/outbox/pure";
import { sellerLocale } from "@/core/catalog/low-stock";
import { buyerFunnel } from "./funnel.server";
import { customersReport, weekStart } from "./customers";
import { readPurchases } from "./customers.server";
import { autoShare } from "./speed";
import { speedStats } from "./speed.server";
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
  WEEKLY_SECTIONS_KEY,
  WEEKLY_SENT_KEY,
  parseWeeklySections,
  type WeekWindow,
  type WeeklyStats,
} from "./weekly";

type Money = { revenue: number; orders: number; ids: number[]; scale: Map<number, number> };

export async function weeklyStats(
  ctx: TenantContext,
  w: WeekWindow,
  now = new Date(),
): Promise<WeeklyStats> {
  const cur = new Map<string, Money>();
  const prev = new Map<string, Money>();
  const blank = (): Money => ({ revenue: 0, orders: 0, ids: [], scale: new Map() });
  const fromIso = w.from.toISOString();
  const { netOfRefunds, refundsSince } = await import("@/core/orders/refund");
  const { loadShopFx } = await import("@/core/money/shop-fx");
  const [refunds, fx] = await Promise.all([
    refundsSince(ctx, w.prevFrom.toISOString()),
    loadShopFx(ctx),
  ]);
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
        // Другие валюты — в основной по курсу на сегодня; без курса — отдельно.
        const k = fx.factor(o.currency);
        const c = k == null ? o.currency || "—" : fx.base;
        const m = map.get(c) ?? blank();
        map.set(c, m);
        const revenue = netOfRefunds(analyticsRevenue(o), refunds.get(o.id)) * (k ?? 1);
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
  if (best < 0) currency = fx.base;
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

  // Скорость заказов, оформленных за неделю (оплата и выдача читаются до «сейчас»).
  const speedAll = (await speedStats(ctx, w.from, w.to, now))[0];
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const speed =
    speedAll && speedAll.placed > 0
      ? {
          payMedian: round(speedAll.pay.median),
          payP90: round(speedAll.pay.p90),
          deliverMedian: round(speedAll.deliver.median),
          autoShare: autoShare(speedAll),
        }
      : null;
  // Новые и вернувшиеся: недели считаются от понедельника после отчётной — неделя отчёта и ей предыдущая.
  const report = customersReport(await readPurchases(ctx, now), ctx.timezone, {
    now: w.to,
    weeks: 4,
  });
  const weekRow = (d: Date) => report.weeks.find((r) => r.week === weekStart(d, ctx.timezone));
  const thisWeek = weekRow(w.from);
  const buyers = thisWeek
    ? {
        fresh: thisWeek.fresh,
        returning: thisWeek.returning,
        prevReturning: weekRow(w.prevFrom)?.returning ?? 0,
      }
    : null;
  return {
    speed,
    buyers,
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

/** Сколько раз за неделю пробуем после временных сбоев; дальше — как постоянный. */
export const WEEKLY_MAX_ATTEMPTS = 4;
export const WEEKLY_ATTEMPTS_KEY = "weekly_report_attempts";

/**
 * Отправить отчёт за прошлую неделю, если пора и ещё не отправлен.
 * Неделю отмечаем атомарно (сравнение с прежним значением) до отправки:
 * два одновременных прогона крона — отправит только один. Выключен в
 * настройках — ничего не считаем и не пишем.
 *
 * `ready` — проверка канала до подсчёта (есть ли бот, расшифровывается ли
 * токен). Её отказ — постоянный по типу, а не по тексту ошибки: неделя
 * отмечается сразу, статистика не считается, повторов нет.
 */
export async function sendWeeklyReport(
  ctx: TenantContext,
  send: (html: string) => Promise<unknown>,
  now = new Date(),
  opts: { ready?: () => void } = {},
): Promise<WeeklyOutcome> {
  if (!weeklyEnabled(await getSetting(ctx, WEEKLY_ENABLED_KEY))) return "off";
  const w = weekWindow(now, ctx.timezone);
  if (!w.due) return "notDue";
  if ((await getSetting(ctx, WEEKLY_SENT_KEY)) === w.week) return "already";
  let before: string | null = null;
  const claimWeek = () =>
    updateSettingAtomic(ctx, WEEKLY_SENT_KEY, (raw) => {
      before = raw;
      return raw === w.week ? null : w.week;
    });
  try {
    opts.ready?.();
  } catch (e) {
    const claim = await claimWeek();
    if (claim !== "written") return claim === "skipped" ? "already" : "failed";
    throw new WeeklySendError(e instanceof Error ? e.message : String(e), true, e);
  }
  const stats = await weeklyStats(ctx, w, now);
  const lang = await sellerLocale(ctx);
  const sections = parseWeeklySections(await getSetting(ctx, WEEKLY_SECTIONS_KEY));
  const claim = await claimWeek();
  if (claim === "skipped") return "already";
  if (claim === "failed") return "failed";
  try {
    await send(renderWeekly(w.label, stats, lang, sections));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Бот заблокирован или попыток за неделю больше лимита — повторы по
    // кругу ничего не дадут: отметка остаётся, сбой уходит в журнал. Иначе
    // (база, сеть) снимаем отметку — следующий прогон попробует снова.
    const permanent = weeklyPermanentFailure(message) || !(await countAttempt(ctx, w.week));
    if (!permanent) {
      const prev: string = before ?? "";
      await updateSettingAtomic(ctx, WEEKLY_SENT_KEY, (raw) => (raw === w.week ? prev : null));
    }
    throw new WeeklySendError(message, permanent, e);
  }
  return "sent";
}

/** +1 попытка за неделю; false — лимит исчерпан (эта была последней). */
async function countAttempt(ctx: TenantContext, week: string): Promise<boolean> {
  let n = 0;
  await updateSettingAtomic(ctx, WEEKLY_ATTEMPTS_KEY, (raw) => {
    const [wk, cnt] = (raw ?? "").split(":");
    n = (wk === week ? Number(cnt) || 0 : 0) + 1;
    return `${week}:${n}`;
  });
  return n < WEEKLY_MAX_ATTEMPTS;
}

/** Отчёт не ушёл; permanent — повторять бессмысленно (отметка недели оставлена). */
export class WeeklySendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WeeklySendError";
  }
}

/** Адресат недоступен навсегда (как в очереди отправки) или токен бота неверный. */
export function weeklyPermanentFailure(message: string): boolean {
  return (
    outboxPermanentFailure(message) ||
    /unauthorized|\b401\b|decrypt|unable to authenticate|не зашифрован|зашифрованный секрет|нет токена/i.test(
      message,
    )
  );
}
