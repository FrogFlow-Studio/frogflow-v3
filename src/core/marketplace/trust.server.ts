import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { trySetSetting } from "@/core/settings/settings";
import { TRUST_KEY, TRUST_WINDOW_DAYS, answerHours, buildTrust, type Trust } from "./trust";

const DAY = 86_400_000;

/**
 * Считает доверие автора по его настоящим заказам и кладёт в `app_settings` (раз в час, из крона
 * площадки). Читает под ролью арендатора, ничего, кроме одной настройки, не пишет. Сбой чтения —
 * ошибка (прежняя запись остаётся), а не «заказов нет».
 */
export async function computeTrust(
  ctx: TenantContext,
  rating: { rating: number | null; count: number },
  now: Date = new Date(),
): Promise<Trust> {
  const botId = ctx.tenant.id;
  const total = await ctx.db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("status", "delivered");
  if (total.error)
    throw serverFailure(`площадка, выданные заказы не посчитаны: ${total.error.message}`);

  const since = new Date(now.getTime() - TRUST_WINDOW_DAYS * DAY).toISOString();
  const recent = await pageAll<{ id: number; created_at: string }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, created_at")
        .eq("bot_id", botId)
        .eq("status", "delivered")
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "площадка, выданные заказы за период не прочитаны",
  );
  const first = new Map<number, string>();
  if (recent.length > 0) {
    const ids = new Set(recent.map((o) => Number(o.id)));
    const events = await pageAll<{ created_at: string; payload: Json }>(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("created_at, payload")
          .eq("bot_id", botId)
          .eq("event_type", "order.status")
          .gte("created_at", since)
          .order("created_at")
          .order("id")
          .range(from, to),
      "площадка, действия продавца не прочитаны",
    );
    for (const e of events) {
      const p = (
        e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? e.payload : {}
      ) as Record<string, unknown>;
      const id = Number(p.order_id);
      // Только действия продавца: автоматические переходы статуса ответом не считаются.
      if (!String(p.actor).startsWith("admin") || !ids.has(id) || first.has(id)) continue;
      first.set(id, e.created_at);
    }
  }
  return buildTrust({
    now,
    deliveredTotal: total.count ?? 0,
    answerHours: answerHours(
      recent.map((o) => ({ id: Number(o.id), createdAt: o.created_at })),
      first,
    ),
    rating: rating.rating,
    ratingCount: rating.count,
  });
}

/** Посчитать и записать; false — запись не удалась (прежняя остаётся). */
export async function refreshTrust(
  ctx: TenantContext,
  rating: { rating: number | null; count: number },
  now: Date = new Date(),
): Promise<boolean> {
  const trust = await computeTrust(ctx, rating, now);
  return trySetSetting(ctx, TRUST_KEY, JSON.stringify(trust));
}
