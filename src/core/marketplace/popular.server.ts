import { pageAll } from "@/core/db/page";
import { trySetSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { POPULAR_KEY, POPULAR_WINDOW_DAYS, buildPopular, type Popular } from "./popular";

const DAY = 86_400_000;

/**
 * Считает «часто покупают» магазина по его выданным заказам за 90 дней. Читает под ролью
 * арендатора. Сбой чтения — ошибка (прежняя запись остаётся), а не «заказов нет».
 */
export async function computePopular(ctx: TenantContext, now: Date = new Date()): Promise<Popular> {
  const since = new Date(now.getTime() - POPULAR_WINDOW_DAYS * DAY).toISOString();
  const orders = await pageAll<{ id: number; telegram_id: number }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, telegram_id")
        .eq("bot_id", ctx.tenant.id)
        .eq("status", "delivered")
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "площадка, выданные заказы не прочитаны",
  );
  const buyerOf = new Map(orders.map((o) => [Number(o.id), Number(o.telegram_id)]));
  const ids = [...buyerOf.keys()];
  const items: Array<{ order_id: number; product_id: string | null }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    items.push(
      ...(await pageAll<{ order_id: number; product_id: string | null }>(
        (from, to) =>
          ctx.db
            .from("order_items")
            .select("order_id, product_id")
            .in("order_id", chunk)
            .order("id")
            .range(from, to),
        "площадка, позиции заказов не прочитаны",
      )),
    );
  }
  const rows = items.flatMap((i) => {
    const buyer = buyerOf.get(Number(i.order_id));
    return buyer != null && i.product_id ? [{ productId: i.product_id, buyer }] : [];
  });
  return buildPopular(rows, now);
}

/** Посчитать и записать; false — запись не удалась (прежняя остаётся). */
export async function refreshPopular(ctx: TenantContext, now: Date = new Date()): Promise<boolean> {
  return trySetSetting(ctx, POPULAR_KEY, JSON.stringify(await computePopular(ctx, now)));
}
