/**
 * «Первые 7 дней» (Р3): короткий чек-лист до первой продажи — товар, оплата,
 * ссылка, пробный заказ. Каждый пункт закрывается только по данным магазина,
 * не по клику: есть включённый товар, есть способ оплаты, в магазине появился
 * первый покупатель кроме продавца, пробный заказ прошёл целиком. Настоящая
 * оплаченная продажа доказывает все четыре сразу. Когда закрыто всё, карточка
 * уходит с «Обзора». Консультанту без продаж её не показываем вовсе.
 */
export const FIRST_WEEK_STEPS = ["product", "payment", "link", "trial"] as const;
export type FirstWeekStep = (typeof FIRST_WEEK_STEPS)[number];

export type FirstWeekFacts = {
  activeProducts: number;
  paymentReady: boolean;
  /** Покупателей в магазине, кроме самого продавца. */
  buyersBesideSeller: number;
  /** Пробный заказ хоть раз прошёл целиком (core/orders/trial). */
  trialPassed: boolean;
  /** Заказов с подтверждённой оплатой. */
  paidOrders: number;
  /**
   * Продаёт ли клиент (`sellsInBot`). Консультант без продаж (BOVI: модуль
   * магазина из v1, товаров нет) чек-лист до первой продажи закрыть не может —
   * карточки нет совсем. Нет значения — продаёт.
   */
  sells?: boolean;
};

export type FirstWeekState = {
  rows: Array<{ step: FirstWeekStep; done: boolean }>;
  doneCount: number;
  percent: number;
  /** Первый несделанный шаг; null — всё сделано. */
  next: FirstWeekStep | null;
  /** Карточку показываем, пока не закрыто всё (и только тому, кто продаёт). */
  visible: boolean;
  sold: boolean;
};

export function firstWeekState(f: FirstWeekFacts): FirstWeekState {
  // Оплаченный заказ — сам по себе доказательство: товар был, оплата работала, покупатель дошёл.
  const sold = f.paidOrders > 0;
  const done: Record<FirstWeekStep, boolean> = {
    product: sold || f.activeProducts > 0,
    payment: sold || f.paymentReady,
    link: sold || f.buyersBesideSeller > 0,
    trial: sold || f.trialPassed,
  };
  const rows = FIRST_WEEK_STEPS.map((step) => ({ step, done: done[step] }));
  const doneCount = rows.filter((r) => r.done).length;
  return {
    rows,
    doneCount,
    percent: Math.round((doneCount / rows.length) * 100),
    next: rows.find((r) => !r.done)?.step ?? null,
    visible: f.sells !== false && doneCount < rows.length,
    sold,
  };
}
