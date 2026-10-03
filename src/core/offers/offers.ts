import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";

/**
 * Ограниченные предложения (модуль limited_offers): скидка в процентах на
 * товар с датой окончания и, по желанию, лимитом проданных штук. Цена со
 * скидкой применяется внутри `resolvePrice` — значит, сразу в боте, Direct,
 * витрине и при оформлении. Хранение — `app_settings.limited_offers` (JSON),
 * своей таблицы нет. Проданное считается по позициям заказов с начала акции,
 * отклонённые и отменённые заказы не в счёт.
 */
export type LimitedOffer = {
  id: string;
  product_id: string;
  percent: number;
  starts_at: string;
  ends_at: string;
  /** Сколько штук по акции; null — без лимита. */
  limit: number | null;
  title?: string;
};

export const OFFERS_KEY = "limited_offers";
export const OFFERS_MAX = 50;

export function parseOffers(raw: string | null | undefined): LimitedOffer[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (o): o is LimitedOffer =>
        Boolean(o) &&
        typeof o === "object" &&
        typeof (o as LimitedOffer).product_id === "string" &&
        Number((o as LimitedOffer).percent) > 0 &&
        Number((o as LimitedOffer).percent) < 100 &&
        !Number.isNaN(Date.parse((o as LimitedOffer).ends_at)),
    );
  } catch {
    return [];
  }
}

export type OfferState = LimitedOffer & { sold: number; left: number | null };

/** Действующая акция товара: время идёт и лимит не выбран; из нескольких — самая щедрая. */
export function activeOfferFor(
  offers: readonly LimitedOffer[],
  productId: string,
  sold: ReadonlyMap<string, number>,
  now = new Date(),
): OfferState | null {
  let best: OfferState | null = null;
  for (const o of offers) {
    if (o.product_id !== productId) continue;
    const t = now.getTime();
    if (t < Date.parse(o.starts_at) || t >= Date.parse(o.ends_at)) continue;
    const s = sold.get(o.id) ?? 0;
    if (o.limit != null && s >= o.limit) continue;
    const state = { ...o, sold: s, left: o.limit == null ? null : o.limit - s };
    if (!best || state.percent > best.percent) best = state;
  }
  return best;
}

export function applyOffer(amount: number, percent: number): number {
  return Math.max(0, Math.round((amount * (100 - percent)) / 100));
}

const cache = new Map<string, { ts: number; offers: LimitedOffer[]; sold: Map<string, number> }>();
const TTL_MS = 60_000;

export function resetOffersCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

async function soldCounts(ctx: TenantContext, offers: readonly LimitedOffer[]) {
  const sold = new Map<string, number>();
  const now = Date.now();
  for (const o of offers) {
    if (o.limit == null || now >= Date.parse(o.ends_at)) continue;
    const { data, error } = await ctx.db
      .from("order_items")
      .select("quantity, orders!inner(status, created_at)")
      .eq("product_id", o.product_id)
      .gte("orders.created_at", o.starts_at)
      .not("orders.status", "in", "(rejected,cancelled)");
    // Без проданного число «осталось» завысилось бы, и лимит акции не удержался бы.
    if (error) throw serverFailure(`Продано по акции ${o.id}: ${error.message}`);
    sold.set(
      o.id,
      (data ?? []).reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    );
  }
  return sold;
}

export async function loadOfferState(ctx: TenantContext) {
  const hit = cache.get(ctx.tenant.id);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;
  const offers = parseOffers(await getSetting(ctx, OFFERS_KEY));
  const entry = { ts: Date.now(), offers, sold: await soldCounts(ctx, offers) };
  cache.set(ctx.tenant.id, entry);
  return entry;
}

/** Действующая акция товара у арендатора (с кешем на минуту). */
export async function offerForProduct(
  ctx: TenantContext,
  productId: string | undefined | null,
): Promise<OfferState | null> {
  if (!productId || !ctx.tenant.modules.limited_offers) return null;
  const { offers, sold } = await loadOfferState(ctx);
  return offers.length ? activeOfferFor(offers, productId, sold) : null;
}

export async function listOffers(ctx: TenantContext): Promise<OfferState[]> {
  resetOffersCache(ctx.tenant.id);
  const { offers, sold } = await loadOfferState(ctx);
  return offers.map((o) => {
    const s = sold.get(o.id) ?? 0;
    return { ...o, sold: s, left: o.limit == null ? null : Math.max(0, o.limit - s) };
  });
}

export async function saveOffers(ctx: TenantContext, offers: LimitedOffer[]): Promise<void> {
  await setSetting(ctx, OFFERS_KEY, JSON.stringify(offers.slice(0, OFFERS_MAX)));
  resetOffersCache(ctx.tenant.id);
}

/** Подпись для карточки: «🔥 −20% до 30.09 23:59 · осталось 5». */
export function offerLabel(o: OfferState, tz: string, locale = "ru"): string {
  const until = new Date(o.ends_at).toLocaleString(locale === "en" ? "en-GB" : "ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const words: Record<string, [string, string]> = {
    ru: ["до", "осталось"],
    kk: ["дейін", "қалды"],
    en: ["until", "left"],
    uz: ["gacha", "qoldi"],
  };
  const [till, left] = words[locale] ?? words.ru!;
  const when = locale === "kk" || locale === "uz" ? `${until} ${till}` : `${till} ${until}`;
  return `🔥 −${o.percent}% ${when}${o.left != null ? ` · ${left} ${o.left}` : ""}`;
}
