import type { TenantContext } from "@/core/tenant/resolve.server";
import { shopCurrency } from "@/core/discounts/discounts";
import { fxRates } from "@/core/pricing/pricing";

/**
 * Пересчёт выручки в основную валюту магазина (настройка `shop_currency`, у
 * казахстанских клиентов — ₸). Курс — тот же, что у цен на витрине
 * (open.er-api.com, кеш 10 минут), на сегодня. Валюта без курса (сбой API без
 * кеша, редкий код) не пересчитывается: её суммы остаются отдельной строкой,
 * как раньше, — молча в ноль они не превращаются.
 */
export type ShopFx = {
  /** Основная валюта магазина, «KZT». */
  base: string;
  /** Сколько единиц основной валюты в одной единице `currency`; null — курса нет. */
  factor(currency: string | null | undefined): number | null;
};

export function shopFxFromRates(base: string, ratesToUsd: Record<string, number> | null): ShopFx {
  const b = base.toUpperCase();
  return {
    base: b,
    factor(currency) {
      // Заказ без валюты — старый, в валюте магазина.
      const c = (currency || b).toUpperCase();
      if (c === b) return 1;
      const f = ratesToUsd?.[c];
      const t = ratesToUsd?.[b];
      if (!f || !t || !Number.isFinite(f) || !Number.isFinite(t)) return null;
      return t / f;
    },
  };
}

export async function loadShopFx(ctx: TenantContext): Promise<ShopFx> {
  const [base, rates] = await Promise.all([shopCurrency(ctx), fxRates()]);
  return shopFxFromRates(base, rates);
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** Сумма в основной валюте; без курса — в своей. */
export function toBase(
  fx: ShopFx,
  amount: number,
  currency: string | null | undefined,
): { amount: number; currency: string } {
  const k = fx.factor(currency);
  return k == null
    ? { amount, currency: (currency || "—").toUpperCase() }
    : { amount: cents(amount * k), currency: fx.base };
}

type MoneyRow = {
  id?: number;
  total: number | string | null;
  paid_amount?: number | string | null;
  currency: string | null;
};

/**
 * Строки заказов и возвраты — в основной валюте: total, paid_amount и сумма
 * возврата умножаются на курс, currency становится основной. Строки без курса
 * не меняются. Расчёты «по основной валюте» после этого складывают всё в ₸.
 */
export function rowsInBase<T extends MoneyRow>(
  fx: ShopFx,
  rows: readonly T[],
  refunds?: ReadonlyMap<number, number>,
): { rows: T[]; refunds: Map<number, number> } {
  const outRefunds = new Map(refunds ?? []);
  const out = rows.map((o) => {
    const k = fx.factor(o.currency);
    if (k == null || (o.currency || fx.base).toUpperCase() === fx.base) return o;
    if (o.id != null && outRefunds.has(o.id))
      outRefunds.set(o.id, cents(outRefunds.get(o.id)! * k));
    const conv = (v: number | string | null | undefined) =>
      v == null ? v : cents((Number(v) || 0) * k);
    return {
      ...o,
      total: conv(o.total) as T["total"],
      ...(o.paid_amount !== undefined ? { paid_amount: conv(o.paid_amount) } : {}),
      currency: fx.base,
    };
  });
  return { rows: out, refunds: outRefunds };
}
