import { pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Что карточка покупателя показывает сверх заказов и чата (А14): кого он
 * пригласил и кто пригласил его, и его отзывы. Только чтение; баллы здесь
 * не считаются и не пересчитываются.
 */
export type CardReferral = {
  telegramId: number;
  name: string;
  status: string;
  rewarded: boolean;
  createdAt: string;
};
export type CardReferrals = {
  /** Кто пригласил этого покупателя; нет — пришёл сам. */
  invitedBy: { telegramId: number; name: string } | null;
  invited: CardReferral[];
};
export type CardReview = {
  id: string;
  productName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

async function namesByTelegramId(ctx: TenantContext, ids: number[]): Promise<Map<number, string>> {
  const rows = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("user_key, telegram_id, first_name, last_name, username")
        .in("telegram_id", chunk)
        .order("user_key"),
    "Карточка: имена приглашённых",
  );
  const out = new Map<number, string>();
  for (const u of rows) {
    const id = Number(u.telegram_id);
    if (out.has(id)) continue;
    out.set(
      id,
      [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : ""),
    );
  }
  return out;
}

export async function customerReferrals(
  ctx: TenantContext,
  telegramId: number,
): Promise<CardReferrals> {
  const [invited, by] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("referrals")
          .select("id, referred_telegram_id, status, rewarded_at, created_at")
          .eq("referrer_telegram_id", telegramId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      "Карточка: приглашённые",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("referrals")
          .select("id, referrer_telegram_id")
          .eq("referred_telegram_id", telegramId)
          .order("id")
          .range(from, to),
      "Карточка: кто пригласил",
    ),
  ]);
  const referrer = by[0] ? Number(by[0].referrer_telegram_id) : null;
  const ids = [
    ...invited.map((r) => Number(r.referred_telegram_id)),
    ...(referrer ? [referrer] : []),
  ];
  const names = ids.length ? await namesByTelegramId(ctx, ids) : new Map<number, string>();
  return {
    invitedBy: referrer ? { telegramId: referrer, name: names.get(referrer) ?? "" } : null,
    invited: invited.map((r) => ({
      telegramId: Number(r.referred_telegram_id),
      name: names.get(Number(r.referred_telegram_id)) ?? "",
      status: r.status,
      rewarded: r.rewarded_at !== null,
      createdAt: r.created_at,
    })),
  };
}

export async function customerReviews(
  ctx: TenantContext,
  buyerIds: number[],
): Promise<CardReview[]> {
  const rows = await inChunks(
    buyerIds,
    (chunk) =>
      ctx.db
        .from("product_reviews")
        .select("id, product_id, rating, comment, created_at")
        .in("telegram_id", chunk)
        .order("id"),
    "Карточка: отзывы",
  );
  const products = await inChunks(
    [...new Set(rows.map((r) => r.product_id))],
    (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).order("id"),
    "Карточка: товары отзывов",
  );
  const name = new Map(products.map((p) => [p.id, p.name]));
  return rows
    .map((r) => ({
      id: r.id,
      productName: name.get(r.product_id) ?? "",
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
    }))
    .sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1,
    );
}
