/**
 * Скорость заказа: сколько проходит от оформления до оплаты и от оплаты до
 * выдачи, и какая доля заказов выдана без действия продавца. Считается по
 * таймлайну заказа (core/orders/events): события placed, payment,
 * delivery_started, delivered. Чистая часть — без базы.
 */

export const SPEED_EVENT_KINDS = [
  "placed",
  "payment",
  "delivery_started",
  "delivered",
  "status",
] as const;

export type SpeedEvent = {
  orderId: number;
  /** Время события, ISO. */
  at: string;
  /** Вид события без префикса `order.`. */
  kind: string;
  actor: string;
  /** Канал заказа — есть у события placed. */
  platform?: string;
};

export type SpeedStat = { count: number; median: number | null; p90: number | null };

export type SpeedRow = {
  /** `all` — все каналы, иначе платформа заказа. */
  channel: string;
  /** Оформлено заказов за период. */
  placed: number;
  /** Оплата: минуты от оформления до оплаты. */
  pay: SpeedStat;
  /** Выдача: минуты от оплаты до выдачи. */
  deliver: SpeedStat;
  delivered: number;
  /** Выдано без действия продавца (карта, автопроверка чека, автовыдача). */
  auto: number;
};

/** Процентиль методом ближайшего ранга; пустой набор — null. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

function stat(values: number[]): SpeedStat {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: percentile(sorted, 50), p90: percentile(sorted, 90) };
}

const minutes = (from: string, to: string) =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60_000);

type OrderTrack = {
  platform: string;
  placedAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  manual: boolean;
};

/**
 * События → строки по каналам. Заказ входит в период, если его «placed»
 * попал в [from, to). Оплата — раньше из первого платежа и начала выдачи
 * (цифровой заказ по чеку платежа не пишет: оплатой считается момент, когда
 * чек принят и пошла выдача). Заказ без оплаты или отменённый до неё в
 * медианы оплаты и выдачи не попадает. «Без продавца» — выданный заказ, в
 * котором нет ни одного действия администратора.
 */
export function orderSpeed(events: SpeedEvent[], from: Date, to: Date): SpeedRow[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.orderId - b.orderId);
  const tracks = new Map<number, OrderTrack>();
  for (const e of sorted) {
    if (e.kind !== "placed") continue;
    const at = new Date(e.at).getTime();
    if (at < from.getTime() || at >= to.getTime() || tracks.has(e.orderId)) continue;
    tracks.set(e.orderId, {
      platform: e.platform || "—",
      placedAt: e.at,
      paidAt: null,
      deliveredAt: null,
      manual: false,
    });
  }
  for (const e of sorted) {
    const t = tracks.get(e.orderId);
    if (!t) continue;
    if (e.actor.startsWith("admin") && e.kind !== "placed") t.manual = true;
    if ((e.kind === "payment" || e.kind === "delivery_started") && !t.paidAt) t.paidAt = e.at;
    if (e.kind === "delivered" && !t.deliveredAt) t.deliveredAt = e.at;
  }
  const groups = new Map<string, OrderTrack[]>();
  for (const t of tracks.values()) {
    const list = groups.get(t.platform) ?? [];
    list.push(t);
    groups.set(t.platform, list);
  }
  const row = (channel: string, list: OrderTrack[]): SpeedRow => {
    const pay = list.filter((t) => t.paidAt).map((t) => minutes(t.placedAt, t.paidAt!));
    const deliver = list
      .filter((t) => t.paidAt && t.deliveredAt)
      .map((t) => minutes(t.paidAt!, t.deliveredAt!));
    const delivered = list.filter((t) => t.deliveredAt);
    return {
      channel,
      placed: list.length,
      pay: stat(pay),
      deliver: stat(deliver),
      delivered: delivered.length,
      auto: delivered.filter((t) => !t.manual).length,
    };
  };
  const all = [...tracks.values()];
  const rows = [...groups.entries()]
    .sort(([a], [b]) => groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b))
    .map(([channel, list]) => row(channel, list));
  return [row("all", all), ...rows];
}

/** Доля выданных без продавца, %; нет выданных — null. */
export function autoShare(r: Pick<SpeedRow, "delivered" | "auto">): number | null {
  return r.delivered ? Math.round((r.auto / r.delivered) * 100) : null;
}
