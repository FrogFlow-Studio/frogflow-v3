import type { Json } from "@/core/db-types";
import { allSellerNotes } from "@/core/customers/seller-notes";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { isLocale } from "@/core/i18n/locale";

/**
 * Сегменты рассылки — кому писать сверх «все / купившие / не купившие /
 * страна». Хранятся в `broadcasts.audience_filter.segment` (jsonb) при
 * `audience_type = "all"`: колонку аудитории не расширяем, у v1 свой набор
 * значений. Все выборки — постранично (pageAll), без молчаливых обрезок.
 * Кто отписался или заблокирован, в сегмент не попадает никогда: сегмент
 * только сужает уже отобранный круг достижимых.
 */
export type Segment =
  | { kind: "product"; productId: string }
  | { kind: "category"; categoryId: string }
  /** Покупали раньше, но не последние N дней. */
  | { kind: "inactive"; days: number }
  | { kind: "language"; locale: string }
  /** В корзине что-то лежит, заказа нет. */
  | { kind: "cart" }
  /** Тег продавца из карточки покупателя (app_settings customer_note:<user_key>). */
  | { kind: "tag"; tag: string }
  /** Ученики курса (модуль courses): все, отстающие, не сдавшие ДЗ, прошедшие; поток — по желанию. */
  | {
      kind: "course";
      productId: string;
      who: "all" | "behind" | "homework" | "completed";
      cohortId: string | null;
    };

export const SEGMENT_KINDS = [
  "product",
  "category",
  "inactive",
  "language",
  "cart",
  "tag",
  "course",
] as const;
export const MAX_INACTIVE_DAYS = 3650;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сегмент из недоверенного jsonb/формы; мусор — null (сегмента нет). */
export function parseSegment(v: unknown): Segment | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  switch (s.kind) {
    case "product":
      return typeof s.productId === "string" && UUID.test(s.productId)
        ? { kind: "product", productId: s.productId }
        : null;
    case "category":
      return typeof s.categoryId === "string" && UUID.test(s.categoryId)
        ? { kind: "category", categoryId: s.categoryId }
        : null;
    case "inactive": {
      const days = Math.floor(Number(s.days));
      return days >= 1 && days <= MAX_INACTIVE_DAYS ? { kind: "inactive", days } : null;
    }
    case "language":
      return isLocale(s.locale) ? { kind: "language", locale: s.locale } : null;
    case "cart":
      return { kind: "cart" };
    case "course": {
      const who = ["all", "behind", "homework", "completed"].includes(String(s.who))
        ? (s.who as "all" | "behind" | "homework" | "completed")
        : null;
      return typeof s.productId === "string" && UUID.test(s.productId) && who
        ? {
            kind: "course",
            productId: s.productId,
            who,
            cohortId: typeof s.cohortId === "string" && UUID.test(s.cohortId) ? s.cohortId : null,
          }
        : null;
    }
    case "tag": {
      const tag = typeof s.tag === "string" ? s.tag.trim().slice(0, 32) : "";
      return tag ? { kind: "tag", tag } : null;
    }
    default:
      return null;
  }
}

/** Достижимый получатель Telegram-рассылки с тем, что нужно сегментам. */
export type Reachable = { id: number; userKey: string; state: Json | null };

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Язык решается по самой строке покупателя, без заказов. */
export function matchesLanguage(seg: { locale: string }, u: Reachable): boolean {
  return obj(u.state).locale === seg.locale;
}

/** Последняя покупка каждого — для «не покупали N дней». */
export function inactiveSince(
  purchases: Array<{ telegram_id: number; created_at: string }>,
  days: number,
  now = Date.now(),
): Set<number> {
  const last = new Map<number, number>();
  for (const p of purchases) {
    const at = Date.parse(p.created_at);
    if (!Number.isFinite(at)) continue;
    const id = Number(p.telegram_id);
    if (at > (last.get(id) ?? 0)) last.set(id, at);
  }
  const edge = now - days * 24 * 3600_000;
  return new Set([...last].filter(([, at]) => at < edge).map(([id]) => id));
}

const CHUNK = 100;

/** id покупателей (Telegram) из сегмента; вызывающий пересекает с достижимыми. */
export async function segmentMembers(
  ctx: TenantContext,
  seg: Segment,
  reachable: Reachable[],
  buyerStatuses: readonly string[],
  now = Date.now(),
): Promise<Set<number>> {
  if (seg.kind === "language")
    return new Set(reachable.filter((u) => matchesLanguage(seg, u)).map((u) => u.id));
  if (seg.kind === "tag") {
    const want = seg.tag.toLowerCase();
    const keys = new Set<string>();
    for (const [key, note] of await allSellerNotes(ctx))
      if (note.tags.some((t) => t.toLowerCase() === want)) keys.add(key);
    return new Set(reachable.filter((u) => keys.has(u.userKey)).map((u) => u.id));
  }

  if (seg.kind === "course") {
    const { courseSegmentMembers } = await import("@/core/courses/segment.server");
    return courseSegmentMembers(ctx, seg.productId, seg.who, seg.cohortId, new Date(now));
  }

  if (seg.kind === "cart") {
    const rows = await pageAll(
      (from, to) => ctx.db.from("cart_items").select("telegram_id").order("id").range(from, to),
      "корзины для рассылки",
    );
    return new Set(rows.map((r) => Number(r.telegram_id)));
  }

  const purchases = await pageAll(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, telegram_id, created_at")
        .in("status", [...buyerStatuses])
        .eq("platform", "telegram")
        .order("id")
        .range(from, to),
    "покупки для рассылки",
  );
  if (seg.kind === "inactive") return inactiveSince(purchases, seg.days, now);

  let productIds: string[] = [];
  if (seg.kind === "product") productIds = [seg.productId];
  else {
    const products = await pageAll(
      (from, to) =>
        ctx.db.from("products").select("id, category_id, category_ids").order("id").range(from, to),
      "товары категории",
    );
    productIds = products
      .filter(
        (p) =>
          p.category_id === seg.categoryId ||
          (Array.isArray(p.category_ids) && (p.category_ids as unknown[]).includes(seg.categoryId)),
      )
      .map((p) => p.id);
  }
  const orderIds = new Set<number>();
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    const items = await pageAll(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("order_id")
          .in("product_id", chunk)
          .order("id")
          .range(from, to),
      "позиции заказов для рассылки",
    );
    for (const it of items) orderIds.add(Number(it.order_id));
  }
  return new Set(
    purchases.filter((p) => orderIds.has(Number(p.id))).map((p) => Number(p.telegram_id)),
  );
}
