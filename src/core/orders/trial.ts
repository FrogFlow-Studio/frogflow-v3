/**
 * «Пробный заказ» (Р4): проверка оформления без заказа. Настоящий заказ в
 * таблице orders попал бы во все отчёты, деньги, награды, комиссию и доверие
 * площадки (их читают десятки запросов), а пометить и вычистить его везде,
 * не меняя схему базы, нельзя. Поэтому пробный заказ ничего не создаёт: он
 * прогоняет товар через тот же расчёт цены, что корзина и заказ, проверяет
 * всё, без чего покупка не дойдёт до конца, и присылает продавцу пробное
 * уведомление. Заказов, платежей, баллов и комиссии нет по построению.
 */
export type TrialIssue =
  | "telegram" // бот не подключён: покупателю негде оформить заказ
  | "payment" // нет способа оплаты: покупатель не увидит, куда платить
  | "file" // цифровой товар без файла: оплатят и ничего не получат
  | "price" // цены нет или она нулевая
  | "currency" // товар не посчитался (разные валюты)
  | "delivery" // физический товар, а самовывоз и доставка выключены
  | "notify"; // некому слать уведомления о заказах

/** Без чего покупка не получится: пробный заказ «не прошёл», пока это не исправлено. */
export const BLOCKING: readonly TrialIssue[] = [
  "telegram",
  "payment",
  "file",
  "price",
  "currency",
  "delivery",
];

export type TrialFacts = {
  telegram: boolean;
  paymentMethods: boolean;
  sellable: boolean;
  physical: boolean;
  pickup: boolean;
  delivery: boolean;
  recipients: number;
  total: number;
  mixedCurrency: boolean;
};

export function trialIssues(f: TrialFacts): TrialIssue[] {
  const out: TrialIssue[] = [];
  if (!f.telegram) out.push("telegram");
  if (!f.paymentMethods) out.push("payment");
  if (!f.sellable) out.push("file");
  if (!(f.total > 0)) out.push("price");
  if (f.mixedCurrency) out.push("currency");
  if (f.physical && !f.pickup && !f.delivery) out.push("delivery");
  if (f.recipients === 0) out.push("notify");
  return out;
}

export const trialPassed = (issues: readonly TrialIssue[]) =>
  !issues.some((i) => BLOCKING.includes(i));

export type TrialResult = {
  /** Прошёл: ни одной блокирующей проблемы. */
  ok: boolean;
  product: { id: string; name: string } | null;
  total: number;
  dueNow: number;
  currency: string;
  issues: TrialIssue[];
  /** sent — пробное уведомление отправлено; recent — недавно уже слали; none — некому/нечем; failed — не ушло. */
  notified: "sent" | "recent" | "none" | "failed";
  noProduct: boolean;
};
