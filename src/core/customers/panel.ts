import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { OPEN_TICKET_DB_STATUSES, TICKET_PREFIX } from "@/core/helpdesk/tickets";
import { displayNo } from "@/core/orders/pure";
import { orderStats, type OrderStats } from "./card";

/** Заказов в боковой панели диалога; полная история — в карточке покупателя. */
export const PANEL_ORDERS = 5;

export type CustomerPanel = {
  /** Ключ для ссылки на карточку покупателя. */
  userKey: string;
  points: number;
  /** Покупки (оплаченные и выполненные заказы) по валютам. */
  stats: OrderStats;
  orders: Array<{
    id: number;
    no: number;
    status: string;
    total: number;
    currency: string;
    createdAt: string;
  }>;
  /** Незакрытые обращения helpdesk; пусто, когда модуль выключен. */
  tickets: Array<{ number: number; subject: string; status: string }>;
};

/**
 * Что продавцу нужно знать о покупателе, пока он отвечает в диалоге: последние
 * заказы, сумма покупок, баллы, открытые обращения. Контактов (телефон, почта)
 * здесь нет — их показывает только карточка, по роли. Только этот профиль:
 * автосклейка по телефону и почте (core/customers/identity) показывает чужие
 * данные при неподтверждённой почте, поэтому в панель не идёт. Нет покупателя — null.
 */
export async function customerPanel(
  ctx: TenantContext,
  telegramId: number,
): Promise<CustomerPanel | null> {
  const botId = ctx.tenant.id;
  const { data: user, error } = await ctx.db
    .from("bot_users")
    .select("user_key, loyalty_points")
    .eq("bot_id", botId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw serverFailure(`Покупатели: ${error.message}`);
  if (!user) return null;

  const [recent, all, tickets] = await Promise.all([
    ctx.db
      .from("orders")
      .select("id, order_no, display_no, status, total, currency, created_at")
      .eq("bot_id", botId)
      .eq("telegram_id", telegramId)
      .order("id", { ascending: false })
      .limit(PANEL_ORDERS),
    // Сумма покупок — по всем заказам, постранично: «последние 5» её не дают.
    pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, status, total, currency, created_at")
          .eq("bot_id", botId)
          .eq("telegram_id", telegramId)
          .order("id", { ascending: false })
          .range(from, to),
      "Заказы покупателя",
    ),
    ctx.tenant.modules.helpdesk
      ? pageAll(
          (from, to) =>
            ctx.db
              .from("zernio_logs")
              .select("id, status, payload")
              .eq("bot_id", botId)
              .like("event_id", `${TICKET_PREFIX}%`)
              .in("status", [...OPEN_TICKET_DB_STATUSES])
              .contains("payload", { telegram_id: telegramId })
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(from, to),
          "Обращения покупателя",
        )
      : Promise.resolve([]),
  ]);
  if (recent.error) throw serverFailure(`Заказы покупателя: ${recent.error.message}`);

  return {
    userKey: user.user_key,
    points: Number(user.loyalty_points) || 0,
    stats: orderStats(all),
    orders: (recent.data ?? []).map((o) => ({
      id: o.id,
      no: displayNo(o),
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      createdAt: o.created_at,
    })),
    tickets: tickets.map((t) => {
      const p = (t.payload ?? {}) as { number?: number; subject?: string };
      return {
        number: Number(p.number) || 0,
        subject: typeof p.subject === "string" ? p.subject : "",
        status: t.status === "pending" ? "waiting" : t.status,
      };
    }),
  };
}
