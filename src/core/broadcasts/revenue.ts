import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { IN_CHUNK, chunksOf } from "@/lib/in-chunks";
import { BUYER_STATUSES } from "./broadcasts";

/**
 * «Принесла» у рассылки: заказы получателей за 72 часа после их `sent_at`.
 * Это сопоставление по времени, а не доказательство причины — подпись в
 * интерфейсе так и говорит. В выручку идут только оплаченные статусы
 * (BUYER_STATUSES); отменённые и возвращённые не считаются вовсе.
 */
export const ATTRIBUTION_MS = 72 * 3600_000;

/** Статусы, по которым заказ не считается ни заказом, ни выручкой. */
const NOT_COUNTED = new Set(["cancelled", "refunded"]);
const PAID = new Set<string>(BUYER_STATUSES);

export type BroadcastRevenue = {
  /** Заказов получателей в окне (без отменённых и возвращённых). */
  orders: number;
  /** Из них оплаченных. */
  paid: number;
  /** Выручка оплаченных заказов по валютам. */
  revenue: Record<string, number>;
  /** Окно последнего получателя ещё не закрыто — цифры вырастут. */
  windowOpen: boolean;
};

export type RecipientSent = { telegram_id: number; sent_at: string };
export type OrderLite = {
  telegram_id: number;
  created_at: string;
  status: string;
  total: number;
  currency: string;
};

export const EMPTY_REVENUE: BroadcastRevenue = {
  orders: 0,
  paid: 0,
  revenue: {},
  windowOpen: false,
};

/** Чистое сопоставление: заказ получателя в пределах 72 часов после его отправки. */
export function attribute(
  recipients: readonly RecipientSent[],
  orders: readonly OrderLite[],
  now: number,
): BroadcastRevenue {
  const sentAt = new Map<number, number>();
  let last = 0;
  for (const r of recipients) {
    const t = Date.parse(r.sent_at);
    if (!Number.isFinite(t)) continue;
    sentAt.set(Number(r.telegram_id), t);
    if (t > last) last = t;
  }
  const out: BroadcastRevenue = {
    orders: 0,
    paid: 0,
    revenue: {},
    windowOpen: last > 0 && last + ATTRIBUTION_MS > now,
  };
  for (const o of orders) {
    if (NOT_COUNTED.has(o.status)) continue;
    const from = sentAt.get(Number(o.telegram_id));
    const at = Date.parse(o.created_at);
    if (from === undefined || !Number.isFinite(at)) continue;
    if (at < from || at > from + ATTRIBUTION_MS) continue;
    out.orders++;
    if (PAID.has(o.status)) {
      out.paid++;
      const cur = (o.currency || "").toUpperCase();
      out.revenue[cur] = (out.revenue[cur] ?? 0) + (Number(o.total) || 0);
    }
  }
  return out;
}

/** Выручка по каждой рассылке из списка (id → итог). Читает постранично, `.in` кусками по 200. */
export async function revenueFor(
  ctx: TenantContext,
  broadcastIds: readonly string[],
  now = Date.now(),
): Promise<Record<string, BroadcastRevenue>> {
  const out: Record<string, BroadcastRevenue> = {};
  for (const id of broadcastIds) {
    const recipients = await pageAll(
      (from, to) =>
        ctx.db
          .from("broadcast_recipients")
          .select("id, telegram_id, sent_at")
          .eq("broadcast_id", id)
          .eq("status", "sent")
          .not("sent_at", "is", null)
          .order("id")
          .range(from, to),
      "Рассылки: получатели для выручки",
    );
    const sent: RecipientSent[] = recipients.map((r) => ({
      telegram_id: Number(r.telegram_id),
      sent_at: String(r.sent_at),
    }));
    if (sent.length === 0) {
      out[id] = EMPTY_REVENUE;
      continue;
    }
    const times = sent.map((r) => Date.parse(r.sent_at)).filter(Number.isFinite);
    const since = new Date(Math.min(...times)).toISOString();
    const until = new Date(Math.max(...times) + ATTRIBUTION_MS).toISOString();
    const orders: OrderLite[] = [];
    for (const chunk of chunksOf(
      sent.map((r) => r.telegram_id),
      IN_CHUNK,
    )) {
      orders.push(
        ...(await pageAll(
          (from, to) =>
            ctx.db
              .from("orders")
              .select("id, telegram_id, created_at, status, total, currency")
              .in("telegram_id", chunk)
              .gte("created_at", since)
              .lte("created_at", until)
              .order("id")
              .range(from, to),
          "Рассылки: заказы получателей",
        )),
      );
    }
    out[id] = attribute(sent, orders, now);
  }
  return out;
}
