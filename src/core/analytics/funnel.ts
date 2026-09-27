/**
 * Воронка покупателя за период, по каналам: пришли → положили в корзину →
 * оформили заказ → оплатили. Схема базы не меняется: этапы собираются из
 * bot_users (новые покупатели), cart_items и orders.
 *
 * Корзина, заказ и оплата — вложенные множества одних и тех же покупателей:
 * заказавший считается и положившим в корзину (после заказа корзина
 * очищается), оплативший — и заказавшим. «Пришли» — новые покупатели
 * периода; купить в периоде может и пришедший раньше, поэтому доля
 * «пришли → корзина» показывается, только если она не больше 100 %.
 *
 * Модуль без базы: его читают сервер, недельный отчёт и тесты.
 */
import { includeOrderInAnalytics } from "./pure";

export const FUNNEL_STAGES = ["arrived", "cart", "ordered", "paid"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type FunnelRow = { channel: string } & Record<FunnelStage, number>;

/** Заказы, которые продавец завёл сам, и тестовые — не путь покупателя. */
const SKIP = new Set(["manual", "admin_test"]);
const KNOWN = new Set(["telegram", "instagram", "whatsapp", "web"]);
const BY_PREFIX: Array<[string, string]> = [
  ["tg_", "telegram"],
  ["ig_", "instagram"],
  ["wa_", "whatsapp"],
  ["web_", "web"],
];

/**
 * Канал по platform, а если его нет (строка корзины) — по префиксу
 * user_key. Пустое и незнакомое значение — Telegram, как в v1
 * (orderChannel). null — не считать вовсе.
 */
export function funnelChannel(
  platform: string | null | undefined,
  key?: string | null,
): string | null {
  if (platform && SKIP.has(platform)) return null;
  if (platform && KNOWN.has(platform)) return platform;
  if (key?.startsWith("manual:")) return null;
  for (const [prefix, ch] of BY_PREFIX) if (key?.startsWith(prefix)) return ch;
  return "telegram";
}

/** Покупатель — user_key, у старых строк без него — tg_<telegram_id>. */
export function buyerKey(userKey: string | null | undefined, telegramId: number | string | null) {
  return userKey || `tg_${telegramId ?? ""}`;
}

type Sets = { arrived: number; cart: Set<string>; ordered: Set<string>; paid: Set<string> };

export class FunnelAcc {
  private by = new Map<string, Sets>();

  private at(channel: string): Sets {
    let s = this.by.get(channel);
    if (!s) {
      s = { arrived: 0, cart: new Set(), ordered: new Set(), paid: new Set() };
      this.by.set(channel, s);
    }
    return s;
  }

  user(u: { platform: string | null; user_key: string | null }) {
    const ch = funnelChannel(u.platform, u.user_key);
    if (ch) this.at(ch).arrived += 1;
  }

  cartItem(c: { user_key: string | null; telegram_id: number | string | null }) {
    const key = buyerKey(c.user_key, c.telegram_id);
    const ch = funnelChannel(null, key);
    if (ch) this.at(ch).cart.add(key);
  }

  order(o: {
    platform: string | null;
    user_key: string | null;
    telegram_id: number | string | null;
    status: string;
    fulfillment_kind?: string | null;
  }) {
    const key = buyerKey(o.user_key, o.telegram_id);
    const ch = funnelChannel(o.platform, key);
    if (!ch) return;
    const s = this.at(ch);
    s.cart.add(key);
    s.ordered.add(key);
    if (includeOrderInAnalytics(o)) s.paid.add(key);
  }

  /** Строка «все каналы» первой, дальше каналы по числу заказавших. */
  rows(): FunnelRow[] {
    const rows = [...this.by.entries()]
      .map(([channel, s]) => ({
        channel,
        arrived: s.arrived,
        cart: s.cart.size,
        ordered: s.ordered.size,
        paid: s.paid.size,
      }))
      .sort((a, b) => b.ordered - a.ordered || b.arrived - a.arrived);
    const total: FunnelRow = { channel: "all", arrived: 0, cart: 0, ordered: 0, paid: 0 };
    for (const r of rows) for (const st of FUNNEL_STAGES) total[st] += r[st];
    return [total, ...rows];
  }
}

/** Доля перехода на следующий этап, %; null — сравнивать не с чем или больше 100 %. */
export function stageRate(prev: number, cur: number): number | null {
  if (prev <= 0 || cur > prev) return null;
  return Math.round((cur / prev) * 100);
}
