import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";

function* chunked<T>(all: T[], size: number): Generator<T[]> {
  for (let i = 0; i < all.length; i += size) yield all.slice(i, i + size);
}
import { publicBuyerName } from "./photos";
import { reviewMetas } from "./photos.server";

export type RecentReview = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  buyer: string | null;
  productId: string;
  productName: string;
  /** Покупка подтверждена: у автора отзыва есть выданный заказ с этим товаром (П3). */
  confirmed: boolean;
};

/**
 * Пары «покупатель — товар», по которым есть выданный заказ. Только статус «выдан»: оплата
 * подтверждена, а возврат статус снимает; отзыв без такого заказа пометки не получает.
 * Ключ покупателя — telegram_id из подтверждённого входа, почта сайта ничего не значит.
 */
export async function confirmedPurchases(
  ctx: TenantContext,
  pairs: ReadonlyArray<{ telegramId: number; productId: string }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (pairs.length === 0) return out;
  const orders = (await inChunks(
    [...new Set(pairs.map((p) => p.telegramId))],
    (chunk) =>
      ctx.db
        .from("orders")
        .select("id, telegram_id")
        .eq("bot_id", ctx.tenant.id)
        .eq("status", "delivered")
        .in("telegram_id", chunk),
    "Отзывы: выданные заказы",
  )) as Array<{ id: number; telegram_id: number }>;
  if (orders.length === 0) return out;
  const buyerOf = new Map(orders.map((o) => [Number(o.id), Number(o.telegram_id)]));
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  const items: Array<{ order_id: number; product_id: string }> = [];
  for (const products of chunked(productIds, 200)) {
    items.push(
      ...((await inChunks(
        orders.map((o) => Number(o.id)),
        (chunk) =>
          ctx.db
            .from("order_items")
            .select("order_id, product_id")
            .in("order_id", chunk)
            .in("product_id", products.slice(0, 200)), // products уже кусок до 200
        "Отзывы: позиции заказов",
      )) as Array<{ order_id: number; product_id: string }>),
    );
  }
  for (const it of items) {
    const buyer = buyerOf.get(Number(it.order_id));
    if (buyer != null) out.add(`${buyer}:${it.product_id}`);
  }
  return out;
}

/**
 * Свежие одобренные продавцом отзывы магазина с текстом — для блока «Отзывы» на
 * главной витрины и страницы «О магазине». Только отзывы товаров, которые сейчас
 * в продаже; неодобренные и без текста не показываем.
 */
export async function recentApprovedReviews(
  ctx: TenantContext,
  limit: number,
): Promise<RecentReview[]> {
  type Row = {
    id: string;
    product_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    telegram_id: number;
  };
  const picked: Row[] = [];
  await eachPage<Row>(
    (a, b) =>
      ctx.db
        .from("product_reviews")
        .select("id, product_id, rating, comment, created_at, telegram_id")
        .order("created_at", { ascending: false })
        .order("id")
        .range(a, b),
    "product_reviews",
    async (rows) => {
      const metas = await reviewMetas(
        ctx,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        if (metas.get(r.id)?.status !== "approved" || !r.comment?.trim()) continue;
        picked.push(r);
      }
      // Берём с запасом: часть отзывов отпадёт вместе со снятыми с продажи товарами.
      return picked.length < limit * 3;
    },
    200,
  );
  if (picked.length === 0) return [];
  const productIds = [...new Set(picked.map((r) => r.product_id))];
  const products = await inChunks(
    productIds,
    (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).eq("is_active", true),
    "Отзывы: товары",
  );
  const names = new Map(
    (products as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const shown = picked.filter((r) => names.has(r.product_id)).slice(0, limit);
  if (shown.length === 0) return [];
  const users = await inChunks(
    [...new Set(shown.map((r) => Number(r.telegram_id)))],
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, first_name, last_name")
        .in("telegram_id", chunk),
    "Отзывы: покупатели",
  );
  const buyers = new Map(
    (
      users as Array<{ telegram_id: number; first_name: string | null; last_name: string | null }>
    ).map((u) => [Number(u.telegram_id), publicBuyerName(u.first_name, u.last_name)]),
  );
  const confirmed = await confirmedPurchases(
    ctx,
    shown.map((r) => ({ telegramId: Number(r.telegram_id), productId: r.product_id })),
  );
  return shown.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    comment: r.comment!.trim(),
    createdAt: r.created_at,
    buyer: buyers.get(Number(r.telegram_id)) ?? null,
    productId: r.product_id,
    productName: names.get(r.product_id)!,
    confirmed: confirmed.has(`${Number(r.telegram_id)}:${r.product_id}`),
  }));
}
