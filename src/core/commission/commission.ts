import {
  COMMISSION_CURRENCY,
  COMMISSION_DEFAULT_START,
  COMMISSION_FREE_MONTHLY,
  COMMISSION_RATE_PERCENT,
  parsePlan,
  type PlanTier,
} from "@/core/plans/registry";
import { REFUNDABLE_STATUSES, receivedAmount } from "@/core/orders/refund";

/**
 * Комиссия платформы с продаж (решение Якова 04.10.2026). База месяца —
 * оплаченные заказы с витрины сайта и маркета (`platform = 'web'`), как бы ни
 * подтвердили оплату (чек, ApiPay, кнопка продавца): считаем по статусу и
 * полученной сумме заказа, а не по способу. Заказы ботов Telegram (в том числе
 * из Mini App: он кладёт корзину в бота, заказ оформляет бот с platform
 * `telegram`), Instagram, WhatsApp и вручную заведённые комиссии не несут.
 * Возврат уменьшает базу. Первые 50 000 ₸ продаж в месяц без комиссии.
 *
 * Месяц заказа — по дате оформления в поясе магазина: оплаченный позже заказ
 * попадёт в месяц оформления, но не в уже выставленный счёт (счёт — раз в месяц).
 */
export type CommissionOrder = {
  platform: string | null;
  status: string;
  total: number | string | null;
  paid_amount?: number | string | null;
  fulfillment_kind?: string | null;
  currency: string | null;
  /** Локальный день оформления `ГГГГ-ММ-ДД` в поясе магазина. */
  day: string;
  /** Сколько по заказу возвращено покупателю (события возврата). */
  refunded?: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Сколько с заказа идёт в базу комиссии: 0 для заказов не с витрины, неоплаченных и в другой валюте. */
export function commissionableAmount(o: CommissionOrder, refunded = 0): number {
  if (o.platform !== "web") return 0;
  if ((o.currency || COMMISSION_CURRENCY) !== COMMISSION_CURRENCY) return 0;
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(o.status)) return 0;
  return Math.max(0, cents(receivedAmount(o) - refunded));
}

/** Ставка тарифа, %; договорной тариф и клиент без плана — без комиссии (null). */
export function commissionRate(plan: string | null | undefined): number | null {
  const p = parsePlan(plan);
  return p?.kind === "tier" ? COMMISSION_RATE_PERCENT[p.tier] : null;
}

export function planTierOf(plan: string | null | undefined): PlanTier | null {
  const p = parsePlan(plan);
  return p?.kind === "tier" ? p.tier : null;
}

/** Месяц `ГГГГ-ММ` дня `ГГГГ-ММ-ДД`. */
export const monthOfDay = (day: string) => day.slice(0, 7);

export type CommissionReason =
  /** Общий выключатель платформы выключен. */
  | "switch_off"
  /** У клиента договорной тариф или нет плана. */
  | "no_rate"
  /** Месяц раньше даты начала у клиента. */
  | "before_start";

export type CommissionMonth = {
  month: string;
  /** Продажи с витрины и маркета за месяц, ₸, за вычетом возвратов и до даты начала не считаются. */
  sales: number;
  orders: number;
  freeLimit: number;
  /** Ставка тарифа, %; null — нет ставки. */
  rate: number | null;
  /** С чего берётся процент: продажи сверх порога. */
  taxable: number;
  /** Комиссия к начислению, ₸; 0, если не начисляется. */
  commission: number;
  /** Начисляется ли комиссия за этот месяц; иначе — почему нет. */
  accrues: boolean;
  reason: CommissionReason | null;
};

export type CommissionInput = {
  month: string;
  orders: readonly CommissionOrder[];
  plan: string | null;
  /** Общий выключатель платформы. */
  enabled: boolean;
  /** `settings.commission.start`; нет — `COMMISSION_DEFAULT_START`. */
  start?: string | null;
};

/** Комиссия клиента за месяц. Чистая функция: ни даты, ни базы. */
export function monthCommission(input: CommissionInput): CommissionMonth {
  const start = input.start || COMMISSION_DEFAULT_START;
  const counted = input.orders.filter((o) => monthOfDay(o.day) === input.month && o.day >= start);
  let sales = 0;
  let orders = 0;
  for (const o of counted) {
    const amount = commissionableAmount(o, o.refunded ?? 0);
    if (amount > 0) {
      sales = cents(sales + amount);
      orders += 1;
    }
  }
  const rate = commissionRate(input.plan);
  const taxable = cents(Math.max(0, sales - COMMISSION_FREE_MONTHLY));
  const reason: CommissionReason | null = !input.enabled
    ? "switch_off"
    : rate === null
      ? "no_rate"
      : input.month < monthOfDay(start)
        ? "before_start"
        : null;
  const accrues = reason === null;
  return {
    month: input.month,
    sales,
    orders,
    freeLimit: COMMISSION_FREE_MONTHLY,
    rate,
    taxable,
    commission: accrues && rate !== null ? cents((taxable * rate) / 100) : 0,
    accrues,
    reason,
  };
}
