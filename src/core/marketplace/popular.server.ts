import { pageAll } from "@/core/db/page";
import { trySetSetting, updateSettingAtomic } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  POPULAR_KEY,
  POPULAR_RUN_KEY,
  POPULAR_RUN_MIN_GAP_MS,
  POPULAR_WINDOW_DAYS,
  buildPopular,
  type Popular,
} from "./popular";

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

/**
 * Проход крона по одному автору (Л5): не больше одного за окно `POPULAR_RUN_MIN_GAP_MS`.
 * Метку «считаю» ставит условное обновление маленькой строки до подсчёта, и считает только
 * победитель: второй запуск (параллельный или повторный после куска бюджета) получает
 * «skipped». Не вышло посчитать или записать — метку снимаем, следующий запуск попробует снова;
 * прежняя запись `marketplace_popular` при этом остаётся.
 */
export async function refreshPopularOnce(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<"updated" | "skipped" | "failed"> {
  const stamp = String(now.getTime());
  const claim = await updateSettingAtomic(ctx, POPULAR_RUN_KEY, (raw) => {
    const last = Number(raw);
    return Number.isFinite(last) &&
      last > 0 &&
      Math.abs(now.getTime() - last) < POPULAR_RUN_MIN_GAP_MS
      ? null
      : stamp;
  });
  if (claim === "skipped") return "skipped";
  if (claim === "failed") return "failed";
  try {
    if (await refreshPopular(ctx, now)) return "updated";
  } catch (e) {
    await releaseClaim(ctx, stamp);
    throw e;
  }
  await releaseClaim(ctx, stamp);
  return "failed";
}

/** Снять свою метку (если за это время её не перезаписал другой запуск). */
async function releaseClaim(ctx: TenantContext, stamp: string) {
  await updateSettingAtomic(ctx, POPULAR_RUN_KEY, (raw) => (raw === stamp ? "0" : null));
}
