/**
 * Доверие к автору по настоящим заказам (П3): «выдано заказов», «отвечает за …», оценка. Цифры
 * считает платформа раз в час (крон площадки) и кладёт в `app_settings.marketplace_trust`;
 * автор их не вводит и не правит. В счёт идут только заказы со статусом «выдан»: оплата
 * подтверждена, а возврат статус снимает. Ждущие оплаты, отменённые и отклонённые не считаются,
 * а почта покупателя сайта ничего не накручивает: заказ выдан только после настоящей оплаты.
 */
import { roundOrders } from "./shops";

export const TRUST_KEY = "marketplace_trust";
/** За какой срок считаем время ответа продавца. */
export const TRUST_WINDOW_DAYS = 90;
/** Меньше стольких заказов с ответом продавца — время ответа не показываем: это не статистика. */
export const TRUST_MIN_ANSWERS = 5;

export type Trust = {
  v: 1;
  /** Когда посчитано (ISO). */
  at: string;
  /** Выдано заказов за всё время, округлённо вниз (roundOrders); 0 — меньше десяти. */
  delivered: number;
  /** Медиана часов от оформления до первого действия продавца по заказу; нет данных — null. */
  answerHours: number | null;
  /** Средняя оценка по одобренным отзывам; нет оценок — null. */
  rating: number | null;
  ratingCount: number;
};

/** Медиана; пустой список — null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Часы ответа продавца: по каждому выданному заказу — от создания до его первого действия
 * (событие «status» от продавца). Заказ без действия продавца (цифровой, выданный сам) не в счёте.
 */
export function answerHours(
  orders: ReadonlyArray<{ id: number; createdAt: string }>,
  firstSellerAction: ReadonlyMap<number, string>,
): number | null {
  const hours: number[] = [];
  for (const o of orders) {
    const at = firstSellerAction.get(o.id);
    if (!at) continue;
    const ms = Date.parse(at) - Date.parse(o.createdAt);
    if (Number.isFinite(ms) && ms >= 0) hours.push(ms / 3_600_000);
  }
  if (hours.length < TRUST_MIN_ANSWERS) return null;
  const m = median(hours);
  return m == null ? null : Math.round(m * 10) / 10;
}

export function buildTrust(input: {
  now: Date;
  deliveredTotal: number;
  answerHours: number | null;
  rating: number | null;
  ratingCount: number;
}): Trust {
  return {
    v: 1,
    at: input.now.toISOString(),
    delivered: roundOrders(input.deliveredTotal),
    answerHours: input.answerHours,
    rating: input.rating,
    ratingCount: input.ratingCount,
  };
}

/** Разбор записи из настроек; чужое и испорченное — null (плашка без цифр, магазин не страдает). */
export function parseTrust(raw: string | null | undefined): Trust | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<Trust>;
    if (t.v !== 1 || typeof t.at !== "string") return null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      v: 1,
      at: t.at,
      delivered: Math.max(0, Math.floor(num(t.delivered) ?? 0)),
      answerHours: num(t.answerHours),
      rating: num(t.rating),
      ratingCount: Math.max(0, Math.floor(num(t.ratingCount) ?? 0)),
    };
  } catch {
    return null;
  }
}

/** «3 ч», «45 мин» для плашки; ключи подписей — в словаре витрины. */
export function answerLabel(hours: number): { unit: "min" | "h" | "d"; n: number } {
  if (hours < 1) return { unit: "min", n: Math.max(1, Math.round(hours * 60)) };
  if (hours < 48) return { unit: "h", n: Math.round(hours) };
  return { unit: "d", n: Math.round(hours / 24) };
}
