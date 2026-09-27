/**
 * Воронка по источникам: те же этапы, что по каналам (core/analytics/funnel),
 * — пришли, корзина, заказ, оплата — и выручка, но разбивка по
 * `state.first_source` покупателя: первая ссылка /start в боте или utm/ref
 * витрины (core/storefront/web-source). Схема базы не меняется.
 *
 * Источники сводятся в группы, чтобы личные ссылки не превращали таблицу в
 * список покупателей: у каждого приглашённого своя ref_-ссылка, у каждого
 * перехода с витрины — свой токен корзины, у каждого товара — своя p_-ссылка.
 * Показываются самые заказывающие группы, остальное — «другие».
 *
 * Модуль без базы: его читают сервер и тесты.
 */
import { buyerKey, funnelChannel, FUNNEL_STAGES, type FunnelStage } from "./funnel";
import { analyticsRevenue, includeOrderInAnalytics } from "./pure";

export const SOURCE_DIRECT = "direct";
export const SOURCE_OTHER = "other";
/** Сколько групп показывать отдельными строками; остальное — «другие». */
export const SOURCE_ROWS = 15;

export type SourceRow = { source: string } & Record<FunnelStage, number> & {
    /** Выручка оплаченных заказов по валютам — суммы разных валют не складываются. */
    revenue: Record<string, number>;
  };

/**
 * Группа источника. «direct» — без ссылки; «referral», «storefront»,
 * «product» — личные и товарные ссылки (в том числе ?ref= витрины); метки (`site:…`, `src_…` и прочие
 * ссылки продавца) — как есть.
 */
export function sourceGroup(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return SOURCE_DIRECT;
  const s = raw.trim().slice(0, 64);
  if (s.startsWith("ref_")) return "referral";
  if (s.startsWith("wc_")) return "storefront";
  if (s.startsWith("p_")) return "product";
  // Личная ссылка с витрины (?ref=…) — такое же приглашение, как ref_ в боте.
  if (s.startsWith("site:") && /(^site:| )ref-/.test(s)) return "referral";
  return s;
}

/**
 * Выручка строки по валютам для показа: сначала основная валюта магазина
 * (даже нулевая), затем остальные с суммой — без пересчёта курсов.
 */
export function revenueParts(
  revenue: Record<string, number>,
  main: string,
): { currency: string; amount: number }[] {
  const rest = Object.entries(revenue)
    .filter(([c, v]) => c !== main && v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
  return [{ currency: main, amount: revenue[main] ?? 0 }, ...rest];
}

type Acc = {
  arrived: number;
  cart: Set<string>;
  ordered: Set<string>;
  paid: Set<string>;
  revenue: Record<string, number>;
};

export class SourceFunnelAcc {
  private by = new Map<string, Acc>();

  private at(source: string): Acc {
    let a = this.by.get(source);
    if (!a) {
      a = { arrived: 0, cart: new Set(), ordered: new Set(), paid: new Set(), revenue: {} };
      this.by.set(source, a);
    }
    return a;
  }

  /** Новый покупатель периода со своим источником. */
  user(u: { platform: string | null; user_key: string | null; state: unknown }) {
    if (!funnelChannel(u.platform, u.user_key)) return;
    this.at(sourceGroup(firstSource(u.state))).arrived += 1;
  }

  cartItem(key: string, source: string) {
    if (!funnelChannel(null, key)) return;
    this.at(source).cart.add(key);
  }

  order(
    o: {
      platform: string | null;
      user_key: string | null;
      telegram_id: number | string | null;
      status: string;
      fulfillment_kind?: string | null;
      total: number | string | null;
      paid_amount?: number | string | null;
      currency: string | null;
    },
    source: string,
  ) {
    const key = buyerKey(o.user_key, o.telegram_id);
    if (!funnelChannel(o.platform, key)) return;
    const a = this.at(source);
    a.cart.add(key);
    a.ordered.add(key);
    if (includeOrderInAnalytics(o)) {
      a.paid.add(key);
      const cur = o.currency || "—";
      a.revenue[cur] = (a.revenue[cur] ?? 0) + analyticsRevenue(o);
    }
  }

  /** «Все» первой строкой, дальше группы по числу заказавших, хвост — «другие». */
  rows(limit = SOURCE_ROWS): SourceRow[] {
    const all = [...this.by.entries()]
      .map(([source, a]) => ({
        source,
        arrived: a.arrived,
        cart: a.cart.size,
        ordered: a.ordered.size,
        paid: a.paid.size,
        revenue: a.revenue,
      }))
      .sort(
        (x, y) =>
          y.ordered - x.ordered || y.arrived - x.arrived || x.source.localeCompare(y.source),
      );
    const shown = all.slice(0, limit);
    const rest = all.slice(limit);
    const sum = (source: string, rows: SourceRow[]): SourceRow => {
      const r: SourceRow = { source, arrived: 0, cart: 0, ordered: 0, paid: 0, revenue: {} };
      for (const x of rows) {
        for (const st of FUNNEL_STAGES) r[st] += x[st];
        for (const [c, v] of Object.entries(x.revenue)) r.revenue[c] = (r.revenue[c] ?? 0) + v;
      }
      return r;
    };
    const out = [sum("all", all), ...shown];
    if (rest.length) out.push(sum(SOURCE_OTHER, rest));
    return out.map((r) => ({
      ...r,
      revenue: Object.fromEntries(Object.entries(r.revenue).map(([c, v]) => [c, Math.round(v)])),
    }));
  }
}

/** state.first_source из jsonb состояния покупателя. */
export function firstSource(state: unknown): unknown {
  return state && typeof state === "object"
    ? (state as { first_source?: unknown }).first_source
    : null;
}
