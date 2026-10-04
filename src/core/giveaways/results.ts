import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { pageAll } from "@/core/db/page";
import { chunksOf, inChunks } from "@/lib/in-chunks";
import {
  analyticsRevenue,
  includeOrderInAnalytics,
  summarizeByCurrency,
  type CurrencySummary,
} from "@/core/analytics/pure";
import { listParticipants } from "./draw";
import { getGiveaway } from "./giveaway";

/**
 * Итоги розыгрыша для продавца: сколько участвовало, сколько из них новые
 * покупатели бота, сколько подписалось на канал и что они купили за 14 дней
 * после конца приёма. Заказ идёт в итог так же, как в аналитике магазина
 * (выданный — полная сумма, физический в работе — внесённое): неоплаченное и
 * отменённое выручкой не считается. Суммы по валютам не складываются.
 */
export const RESULTS_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export type GiveawayResults = {
  /** Сколько человек участвовало (все записи участия, до отбора по условиям). */
  participants: number;
  /** Допущено к выбору; null — выбор ещё не сделан. */
  eligible: number | null;
  /** Участники, у которых запись в боте появилась уже после начала розыгрыша. */
  newBuyers: number;
  /**
   * Участвовали при условии подписки на канал (проверка — при входе через
   * Telegram); null — условия подписки в розыгрыше нет.
   */
  subscribed: number | null;
  /** Окно заказов: [from, to) и закончилось ли оно. */
  window: { from: string; to: string; closed: boolean; days: number };
  /** Участники хотя бы с одним учтённым заказом в окне. */
  buyers: number;
  orders: number;
  /** Выручка по валютам. */
  revenue: Record<string, CurrencySummary>;
};

export async function giveawayResults(
  ctx: TenantContext,
  id: string,
  now = new Date(),
): Promise<GiveawayResults> {
  const g = await getGiveaway(ctx, id);
  if (!g) throw new UserError("err.giveaway.notFound", "Розыгрыш не найден.");
  const people = await listParticipants(ctx, g.id);
  const from = Date.parse(g.endsAt);
  const to = from + RESULTS_WINDOW_DAYS * DAY_MS;
  const keys = people.map((p) => p.userKey);
  const ids = [...new Set(people.flatMap((p) => (p.telegramId ? [p.telegramId] : [])))];

  const users = await inChunks(
    keys,
    (chunk) => ctx.db.from("bot_users").select("user_key, created_at").in("user_key", chunk),
    "Розыгрыш: покупатели",
  );
  const startedAt = Date.parse(g.createdAt);
  const newBuyers = users.filter((u) => Date.parse(u.created_at) >= startedAt).length;

  const buyerIds = new Set<number>();
  const counted: Array<{ currency: string | null; revenue: number }> = [];
  if (from < now.getTime()) {
    const upTo = Math.min(to, now.getTime());
    for (const chunk of chunksOf(ids)) {
      const rows = await pageAll(
        (a, b) =>
          ctx.db
            .from("orders")
            .select("id, telegram_id, status, total, paid_amount, currency, fulfillment_kind")
            .in("telegram_id", chunk)
            .gte("created_at", new Date(from).toISOString())
            .lt("created_at", new Date(upTo).toISOString())
            .order("id")
            .range(a, b),
        "Розыгрыш: заказы участников",
      );
      for (const o of rows) {
        if (!includeOrderInAnalytics(o)) continue;
        buyerIds.add(Number(o.telegram_id));
        counted.push({ currency: o.currency, revenue: analyticsRevenue(o) });
      }
    }
  }
  return {
    participants: people.length,
    eligible: g.result ? g.result.eligible : null,
    newBuyers,
    subscribed: g.subscribeChannel ? people.filter((p) => p.telegramId !== null).length : null,
    window: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      closed: now.getTime() >= to,
      days: RESULTS_WINDOW_DAYS,
    },
    buyers: buyerIds.size,
    orders: counted.length,
    revenue: summarizeByCurrency(counted),
  };
}
