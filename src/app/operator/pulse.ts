/**
 * Пульс клиента для оператора: сравнение заказов за 14 дней с предыдущими
 * 14, давность последнего входа продавца и признак «затих». Чистые функции —
 * чтение базы в `pulse.server.ts`.
 */

export const PULSE_DAYS = 14;
const DAY_MS = 86_400_000;

export type Pulse = {
  /** Заказов за последние 14 дней. */
  recent: number;
  /** Заказов за 14 дней до этого. */
  previous: number;
  /** Изменение в процентах; null — раньше заказов не было, считать нечего. */
  changePct: number | null;
  /** Дней с последнего заказа; null — заказов не было вовсе или это неизвестно (см. orderKnown). */
  daysSinceOrder: number | null;
  /** false — статистика клиента не прочиталась: «заказов не было» утверждать нельзя. */
  orderKnown: boolean;
  /** Последний успешный вход в админку (журнал хранится 90 дней); null — не было за 90 дней. */
  lastLoginAt: string | null;
  /** Дней с последнего входа; null — не заходил за весь срок хранения журнала. */
  daysSinceLogin: number | null;
  /** Последнее действие продавца с заказом (подтверждение, статус, оплата) за 14 дней; null — не было. */
  lastActionAt: string | null;
  /** Заказы упали вдвое и больше. */
  ordersDropped: boolean;
  /** Нет входа в админку 14 дней и нет действий продавца с заказами (бот, чат). */
  noLogin: boolean;
  /** Затих: упали заказы или нет входа. */
  quiet: boolean;
  /** Для сортировки: чем больше, тем раньше клиента надо набрать. */
  risk: number;
};

export type PulseInput = {
  ordersAt: string[];
  lastLoginAt: string | null;
  /** Последнее действие продавца с заказом (журнал заказа, actor admin*); null/не задано — не было. */
  lastSellerActionAt?: string | null;
  /** undefined — статистика не прочиталась (≠ null: заказов не было). */
  lastOrderAt: string | null | undefined;
  createdAt: string | null;
  status: string;
  now: Date;
};

const daysBetween = (from: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / DAY_MS));

export function computePulse(i: PulseInput): Pulse {
  const nowMs = i.now.getTime();
  const recentFrom = nowMs - PULSE_DAYS * DAY_MS;
  const prevFrom = nowMs - 2 * PULSE_DAYS * DAY_MS;
  let recent = 0;
  let previous = 0;
  for (const at of i.ordersAt) {
    const t = Date.parse(at);
    if (t >= recentFrom) recent += 1;
    else if (t >= prevFrom) previous += 1;
  }
  const changePct = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
  const daysSinceOrder = i.lastOrderAt ? daysBetween(i.lastOrderAt, i.now) : null;
  const daysSinceLogin = i.lastLoginAt ? daysBetween(i.lastLoginAt, i.now) : null;
  // Новичка и клиента на паузе молчание не тревожит: ему ещё нечего терять / он сам остановился.
  const tracked =
    i.status === "active" &&
    !(i.createdAt && nowMs - Date.parse(i.createdAt) < PULSE_DAYS * DAY_MS);
  const ordersDropped = tracked && previous >= 2 && recent * 2 <= previous;
  const daysSinceAction = i.lastSellerActionAt ? daysBetween(i.lastSellerActionAt, i.now) : null;
  // Продавец, который работает из бота, в админку не ходит: «нет входа» тревожит только без его действий.
  const worksInBot = daysSinceAction !== null && daysSinceAction < PULSE_DAYS;
  const noLogin =
    tracked && !worksInBot && (daysSinceLogin === null || daysSinceLogin >= PULSE_DAYS);
  const risk =
    (ordersDropped ? 50 + Math.min(50, Math.round(100 - (recent / previous) * 100) / 2) : 0) +
    (noLogin ? 30 + Math.min(20, (daysSinceLogin ?? 90) / 2) : 0);
  return {
    recent,
    previous,
    changePct,
    daysSinceOrder,
    orderKnown: i.lastOrderAt !== undefined,
    lastLoginAt: i.lastLoginAt,
    daysSinceLogin,
    lastActionAt: i.lastSellerActionAt ?? null,
    ordersDropped,
    noLogin,
    quiet: ordersDropped || noLogin,
    risk,
  };
}
