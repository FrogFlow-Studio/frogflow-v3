import { eachPage, pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { dayKey } from "@/core/analytics/pure";
import type { Json } from "@/core/db-types";
import type { AdminRole } from "@/core/auth/roles";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { displayNo } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Центр уведомлений (колокольчик): лента последних событий магазина из
 * существующих журналов, без своей таблицы — новый заказ, чек на проверке и
 * возврат (таймлайн заказов в zernio_logs), отзыв (product_reviews). Отметка
 * «прочитано» — время по логину в bots.settings.notify_read.
 */
export type NotifyType = "order" | "receipt" | "review" | "refund";
export const NOTIFY_TYPES: readonly NotifyType[] = ["order", "receipt", "review", "refund"];

export type NotifyItem = {
  id: string;
  type: NotifyType;
  at: string;
  /** Заказ, на который ведёт ссылка (нет — у отзыва). */
  orderId: number | null;
  orderNo: number | null;
  /** Имя покупателя; бухгалтеру не отдаётся. */
  buyer: string | null;
  /** Сумма возврата или заказа. */
  amount: number | null;
  currency: string | null;
  rating: number | null;
  comment: string | null;
  read: boolean;
};

/** Окно ленты: события за последние 30 дней; в ответе — не больше `FEED_SHOWN` свежих. */
export const FEED_DAYS = 30;
export const FEED_SHOWN = 100;

/** Какие типы видит роль: бухгалтер — только деньги и заказы, без отзывов. */
export function typesForRole(role: AdminRole | undefined): NotifyType[] {
  return role === "accountant" ? ["order", "receipt", "refund"] : [...NOTIFY_TYPES];
}

const EVENT_TYPES: Record<string, NotifyType> = {
  "order.placed": "order",
  "order.proof": "receipt",
  "order.refund": "refund",
};

type Raw = Omit<NotifyItem, "read" | "orderNo" | "buyer"> & { orderNo?: null };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? n : null;
};
const obj = (v: Json | null | undefined): Record<string, Json | undefined> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : {};

/** Свежие первыми; одинаковое время — по id, чтобы порядок не прыгал. */
export function sortFeed<T extends { at: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}

/** Прочитано — всё не новее отметки; без отметки прочитанного нет. */
export function isRead(at: string, readAt: string | undefined): boolean {
  return Boolean(readAt) && Date.parse(at) <= Date.parse(readAt!);
}

/** «Сегодня» и «раньше» по часовому поясу магазина. */
export function groupFeed<T extends { at: string }>(
  items: T[],
  tz: string,
  now: Date = new Date(),
): { today: T[]; earlier: T[] } {
  const today = dayKey(now, tz);
  return {
    today: items.filter((i) => dayKey(i.at, tz) === today),
    earlier: items.filter((i) => dayKey(i.at, tz) !== today),
  };
}

export async function listNotifications(
  ctx: TenantContext,
  opts: { role: AdminRole | undefined; readAt?: string; now?: Date },
): Promise<{ items: NotifyItem[]; total: number; unread: number }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - FEED_DAYS * 86400_000).toISOString();
  const allowed = new Set(typesForRole(opts.role));
  const raws: Raw[] = [];

  const kinds = Object.entries(EVENT_TYPES)
    .filter(([, type]) => allowed.has(type))
    .map(([k]) => k);
  if (kinds.length) {
    await eachPage<{ id: string; created_at: string; event_type: string; payload: Json | null }>(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("id, created_at, event_type, payload")
          .eq("bot_id", ctx.tenant.id)
          .eq("status", ORDER_EVENT_STATUS)
          .in("event_type", kinds)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "Уведомления: события заказов",
      (rows) => {
        for (const r of rows) {
          const p = obj(r.payload);
          const orderId = num(p.order_id);
          const type = EVENT_TYPES[r.event_type]!;
          raws.push({
            id: `e:${r.id}`,
            type,
            at: r.created_at,
            orderId,
            amount: type === "refund" ? num(p.amount) : null,
            currency: typeof p.currency === "string" ? p.currency : null,
            rating: null,
            comment: null,
          });
        }
      },
    );
  }
  if (allowed.has("review")) {
    const reviews = await pageAll<{
      id: string;
      created_at: string;
      rating: number;
      comment: string | null;
    }>(
      (from, to) =>
        ctx.db
          .from("product_reviews")
          .select("id, created_at, rating, comment")
          .eq("bot_id", ctx.tenant.id)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "Уведомления: отзывы",
    );
    for (const r of reviews)
      raws.push({
        id: `r:${r.id}`,
        type: "review",
        at: r.created_at,
        orderId: null,
        amount: null,
        currency: null,
        rating: r.rating,
        comment: r.comment,
      });
  }

  const sorted = sortFeed(raws);
  const shown = sorted.slice(0, FEED_SHOWN);

  // Номера и имена — только для показанных заказов, кусками по 200.
  const ids = [...new Set(shown.map((s) => s.orderId).filter((x): x is number => x !== null))];
  const orders = new Map<
    number,
    { no: number; name: string | null; total: number; currency: string }
  >();
  const found = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("orders")
        .select("id, order_no, display_no, display_name, total, currency")
        .eq("bot_id", ctx.tenant.id)
        .in("id", chunk)
        .order("id"),
    "Уведомления: заказы",
  );
  for (const o of found)
    orders.set(o.id, {
      no: displayNo(o),
      name: o.display_name,
      total: Number(o.total),
      currency: o.currency,
    });
  const accountant = opts.role === "accountant";
  const items: NotifyItem[] = [];
  for (const s of shown) {
    const o = s.orderId !== null ? orders.get(s.orderId) : undefined;
    // Событие чужого или удалённого заказа в ленту не попадает.
    if (s.orderId !== null && !o) continue;
    items.push({
      ...s,
      orderNo: o?.no ?? null,
      buyer: accountant ? null : (o?.name ?? null),
      amount: s.type === "refund" ? s.amount : (o?.total ?? null),
      currency: s.currency ?? o?.currency ?? null,
      read: isRead(s.at, opts.readAt),
    });
  }
  return { items, total: sorted.length, unread: items.filter((i) => !i.read).length };
}
