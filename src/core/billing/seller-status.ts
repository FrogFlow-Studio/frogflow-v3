import { computeState, type OverduePolicy, type SubscriptionState } from "./subscription";

/**
 * Состояние подписки так, как его видит продавец: до какого дня оплачено, сколько
 * осталось или просрочено и когда бот встанет. Считает то же, что обход подписок
 * (`computeState` и политика клиента), поэтому плашка не обещает другого, чем сделает крон.
 */
export type SellerSubscription = {
  state: Exclude<SubscriptionState, "no_data">;
  /** Последний оплаченный день, YYYY-MM-DD. */
  paidUntil: string;
  /** Дней до конца; отрицательное — сколько дней просрочено. */
  daysLeft: number;
  mode: "warn" | "suspend";
  graceDays: number;
  /** День, когда обход приостановит бот; null — политика «только напоминать» или уже приостановлен. */
  stopOn: string | null;
  /** Бот уже приостановлен. */
  suspended: boolean;
};

const DAY_MS = 86_400_000;

export function sellerSubscription(
  expiresAt: string | null,
  policy: OverduePolicy,
  suspended: boolean,
  now = new Date(),
): SellerSubscription | null {
  const sub = computeState(expiresAt, policy, now);
  if (sub.state === "no_data" || !sub.expiresAt || sub.daysLeft === null) return null;
  const end = new Date(sub.expiresAt);
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const stop = new Date(endDay + (policy.grace_days + 1) * DAY_MS).toISOString().slice(0, 10);
  return {
    state: sub.state,
    paidUntil: new Date(endDay).toISOString().slice(0, 10),
    daysLeft: sub.daysLeft,
    mode: policy.on_overdue,
    graceDays: policy.grace_days,
    stopOn: policy.on_overdue === "suspend" && !suspended && sub.daysLeft < 0 ? stop : null,
    suspended,
  };
}
