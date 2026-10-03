/**
 * Состояние подписки клиента на платформу — из дат, без базы. Отличается от
 * bots.status намеренно: статус — то, что выставил оператор, состояние — то,
 * что следует из дат; их расхождение и есть повод что-то сделать. Сравнение
 * по календарным дням, а не по моментам: подписка «до 1 сентября» не должна
 * протухать в полночь по UTC у клиента в другом поясе.
 */
export type OverduePolicy = {
  on_overdue: "warn" | "suspend";
  warn_days_before: number;
  grace_days: number;
};

export const DEFAULT_POLICY: OverduePolicy = {
  on_overdue: "warn",
  warn_days_before: 5,
  grace_days: 3,
};

/** Поведение при неоплате — из bots.settings (те же ключи, что в v1). */
export function readPolicy(settings: unknown): OverduePolicy {
  const s = (settings ?? {}) as Partial<Record<keyof OverduePolicy, unknown>>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    on_overdue: s.on_overdue === "suspend" ? "suspend" : "warn",
    warn_days_before: num(s.warn_days_before, DEFAULT_POLICY.warn_days_before),
    grace_days: num(s.grace_days, DEFAULT_POLICY.grace_days),
  };
}

export type SubscriptionState =
  /** Дата не заполнена — подписка не заведена. */
  | "no_data"
  | "ok"
  /** Истекает в ближайшие warn_days_before дней. */
  | "expiring"
  /** Просрочена, но в пределах grace_days. */
  | "overdue"
  /** Просрочка дольше отсрочки — пора применять политику. */
  | "grace_over";

export type SubscriptionStatus = {
  state: SubscriptionState;
  expiresAt: string | null;
  /** Дней до истечения; отрицательное — сколько дней уже просрочено. */
  daysLeft: number | null;
  policy: OverduePolicy;
};

const DAY_MS = 86_400_000;

export function computeState(
  expiresAt: string | null,
  policy: OverduePolicy,
  now = new Date(),
): SubscriptionStatus {
  if (!expiresAt) return { state: "no_data", expiresAt: null, daysLeft: null, policy };
  const end = new Date(expiresAt);
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysLeft = Math.round((endDay - nowDay) / DAY_MS);
  let state: SubscriptionState;
  if (daysLeft >= 0) state = daysLeft <= policy.warn_days_before ? "expiring" : "ok";
  else if (-daysLeft <= policy.grace_days) state = "overdue";
  else state = "grace_over";
  return { state, expiresAt, daysLeft, policy };
}

/**
 * Срок подписки подтверждён платежами? Дата без единого записанного платежа
 * (например, досталась от заведения строки) — неподтверждённая, панель
 * оператора об этом предупреждает. Нет даты — предупреждать не о чем.
 */
export function expiryBackedByPayments(expiresAt: string | null, paymentCount: number): boolean {
  return !expiresAt || paymentCount > 0;
}
