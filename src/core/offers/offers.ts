import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, updateSettingStamped } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
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
  /** Товар акции; у акции на категорию — пустая строка (см. `category_id`). */
  product_id: string;
  /** Акция на всю категорию: действует на товары, у которых она в `category_ids`. Лимит штук тут не ставится. */
  category_id?: string;
  /**
   * Новая цена вместо процента (в валюте товара, только для акции на товар).
   * `percent` при этом хранит эквивалентную скидку для бейджа и сортировки.
   */
  new_price?: number;
  percent: number;
  /** Продавец позвал покупателей (core/offers/announce): рассылка и время; по ним кроны шлют напоминание. */
  broadcast_id?: string;
  announced_at?: string;
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
        ((o as LimitedOffer).product_id !== "" || Boolean((o as LimitedOffer).category_id)) &&
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
  categoryIds: readonly string[] = [],
): OfferState | null {
  let best: OfferState | null = null;
  for (const o of offers) {
    const hits = o.category_id ? categoryIds.includes(o.category_id) : o.product_id === productId;
    if (!hits) continue;
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

/**
 * Цена по акции. Процентная — как `applyOffer`; «новая цена» — доля новой цены
 * от основной цены товара, применённая к цене покупателя: она же верна для
 * варианта и для другой валюты по курсу.
 */
export function applyOfferTo(
  amount: number,
  offer: Pick<LimitedOffer, "percent" | "new_price">,
  productPrice: number,
): number {
  if (offer.new_price != null && productPrice > 0) {
    const ratio = Math.min(1, Math.max(0, offer.new_price / productPrice));
    return Math.max(0, Math.round(amount * ratio));
  }
  return applyOffer(amount, offer.percent);
}

/** Процент скидки, эквивалентный новой цене (1–99), для бейджа. */
export function percentForNewPrice(newPrice: number, productPrice: number): number {
  if (!(productPrice > 0) || !(newPrice >= 0) || newPrice >= productPrice) return 0;
  return Math.min(99, Math.max(1, Math.round((1 - newPrice / productPrice) * 100)));
}

const cache = new Map<string, { ts: number; offers: LimitedOffer[]; sold: Map<string, number> }>();
const TTL_MS = 60_000;

export function resetOffersCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Метка позиции заказа, оформленной по акции: по ней считается проданное по лимиту.
 * Видимая «🔥» и невидимый разделитель U+2063: считаем только по разделителю, потому что
 * «🔥» бывает в самом названии товара («Хит 🔥»).
 */
export const OFFER_ROW_MARK = "🔥\u2063";
const OFFER_ROW_TAIL = "\u2063";

/** Название позиции без метки акции — для сообщений и повтора заказа. */
export function stripOfferMark(name: string): string {
  return name.endsWith(OFFER_ROW_MARK) ? name.slice(0, -OFFER_ROW_MARK.length).trimEnd() : name;
}

/**
 * Позиции заказа для повтора: «по акции» и «по полной» — две строки одного товара —
 * сводятся в одну (сумма штук), чтобы остаток и потолок штук считались на товар, а не на строку.
 */
export function mergeOrderItems<
  T extends { product_id: string | null; product_variant_id: string | null; quantity: unknown },
>(items: readonly T[]): Array<T & { quantity: number }> {
  const out = new Map<string, T & { quantity: number }>();
  for (const it of items) {
    const key = `${it.product_id ?? ""}:${it.product_variant_id ?? ""}`;
    const qty = Number(it.quantity) || 1;
    const have = out.get(key);
    if (have && it.product_id) have.quantity += qty;
    else out.set(it.product_id ? key : `${key}:${out.size}`, { ...it, quantity: qty });
  }
  return [...out.values()];
}
/** Заказы до этой даты записывали все штуки товара по акции, без метки и без деления на «по акции» и «остальные». */
const OFFER_MARK_SINCE = Date.parse("2026-10-04T00:00:00Z");

/**
 * Сколько штук продано по акции с лимитом. Считаются позиции с меткой акции
 * (и все позиции старых заказов); «остальные штуки по полной цене» в лимит
 * не входят. Отклонённые и отменённые заказы не в счёт.
 */
export async function soldForOffer(ctx: TenantContext, o: LimitedOffer): Promise<number> {
  const rows = await pageAll<{
    quantity: number | string;
    name_snapshot: string | null;
    orders: { created_at: string } | { created_at: string }[] | null;
  }>(
    (from, to) =>
      ctx.db
        .from("order_items")
        .select("quantity, name_snapshot, orders!inner(status, created_at)")
        .eq("product_id", o.product_id)
        .gte("orders.created_at", o.starts_at)
        .not("orders.status", "in", "(rejected,cancelled)")
        .order("id")
        .range(from, to),
    // Без проданного число «осталось» завысилось бы, и лимит акции не удержался бы.
    `Продано по акции ${o.id}`,
  );
  let sold = 0;
  for (const r of rows) {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    const legacy = !ord || Date.parse(ord.created_at) < OFFER_MARK_SINCE;
    if (legacy || (r.name_snapshot ?? "").endsWith(OFFER_ROW_TAIL)) sold += Number(r.quantity) || 0;
  }
  return sold;
}

async function soldCounts(ctx: TenantContext, offers: readonly LimitedOffer[]) {
  const sold = new Map<string, number>();
  const now = Date.now();
  for (const o of offers) {
    if (o.limit == null || o.category_id || now >= Date.parse(o.ends_at)) continue;
    sold.set(o.id, await soldForOffer(ctx, o));
  }
  return sold;
}

export async function loadOfferState(ctx: TenantContext) {
  const hit = cache.get(ctx.tenant.id);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;
  const offers = parseOffers(await getSettingStrict(ctx, OFFERS_KEY));
  const entry = { ts: Date.now(), offers, sold: await soldCounts(ctx, offers) };
  cache.set(ctx.tenant.id, entry);
  return entry;
}

/** Действующая акция товара у арендатора (с кешем на минуту). */
export async function offerForProduct(
  ctx: TenantContext,
  productId: string | undefined | null,
  categoryIds: readonly string[] = [],
): Promise<OfferState | null> {
  if (!productId || !ctx.tenant.modules.limited_offers) return null;
  const { offers, sold } = await loadOfferState(ctx);
  return offers.length ? activeOfferFor(offers, productId, sold, new Date(), categoryIds) : null;
}

/** Акция товара по его строке из каталога: учитывает и акции на его категории. */
export async function offerForProductRow(
  ctx: TenantContext,
  p: { id: string; category_ids?: unknown },
): Promise<OfferState | null> {
  return offerForProduct(ctx, p.id, productCategoryIds(p));
}

export function productCategoryIds(p: { category_ids?: unknown }): string[] {
  return Array.isArray(p.category_ids)
    ? p.category_ids.filter((c): c is string => typeof c === "string")
    : [];
}

/** Идёт ли сейчас хоть одна акция — показывать ли на витрине фильтр «Со скидкой». */
export async function hasActiveOffers(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.modules.limited_offers) return false;
  const { offers, sold } = await loadOfferState(ctx);
  const now = new Date();
  return offers.some((o) => {
    if (now < new Date(o.starts_at) || now >= new Date(o.ends_at)) return false;
    return o.limit == null || (sold.get(o.id) ?? 0) < o.limit;
  });
}

export async function listOffers(ctx: TenantContext): Promise<OfferState[]> {
  resetOffersCache(ctx.tenant.id);
  const { offers, sold } = await loadOfferState(ctx);
  return offers.map((o) => {
    const s = sold.get(o.id) ?? 0;
    return { ...o, sold: s, left: o.limit == null ? null : Math.max(0, o.limit - s) };
  });
}

/**
 * Изменить список акций: читаем свежий список, правим, пишем с условием на метку
 * записи (весь список в адрес запроса не кладём). Параллельная правка — вторая
 * вкладка, рассылка — не затирает чужое: проигравший перечитывает и применяет
 * правку заново. `change` должна быть чистой; null — ничего не писать.
 */
export async function updateOffers(
  ctx: TenantContext,
  change: (offers: LimitedOffer[]) => LimitedOffer[] | null,
): Promise<void> {
  const r = await updateSettingStamped(ctx, OFFERS_KEY, (raw) => {
    const next = change(parseOffers(raw));
    return next ? JSON.stringify(next.slice(0, OFFERS_MAX)) : null;
  });
  resetOffersCache(ctx.tenant.id);
  if (r === "failed") throw serverFailure("Акции: не удалось записать список");
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
