/** Чистые расчёты скидок — общие для бота, витрины и админки. */
export type PromoDiscountType = "percent" | "fixed";

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

export function computePromoDiscount(
  subtotal: number,
  promo: { discount_type: PromoDiscountType; discount_value: number },
): number {
  if (subtotal <= 0) return 0;
  const raw =
    promo.discount_type === "percent"
      ? subtotal * (promo.discount_value / 100)
      : promo.discount_value;
  return Math.min(subtotal, Math.max(0, Math.round(raw)));
}

export function computeGiftDiscount(subtotal: number, amount: number): number {
  if (subtotal <= 0 || amount <= 0) return 0;
  return Math.min(subtotal, amount);
}

export function computePointsEarned(orderTotal: number, earnPercent: number): number {
  if (orderTotal <= 0 || earnPercent <= 0) return 0;
  return Math.floor(orderTotal * (earnPercent / 100));
}

/**
 * Сколько баллов списать: не больше баланса и не больше maxPercent % суммы
 * (потолок продавца, loyalty_max_redeem_percent; 100 — вся сумма, как в v1).
 */
export function computePointsDiscount(
  subtotal: number,
  pointsBalance: number,
  maxPercent = 100,
): number {
  if (subtotal <= 0 || pointsBalance <= 0) return 0;
  const pct = Number.isFinite(maxPercent) ? Math.min(100, Math.max(0, maxPercent)) : 100;
  const cap = Math.floor((subtotal * pct) / 100);
  return Math.max(0, Math.min(cap, Math.floor(pointsBalance)));
}

export function generateGiftCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `GIFT-${s}`;
}

/**
 * Итог корзины после скидок в порядке v1: промокод → баллы → сертификат.
 * Каждая следующая скидка считается от остатка, итог не ниже нуля.
 */
export function applyDiscounts(
  subtotal: number,
  d: {
    promo?: { discount_type: PromoDiscountType; discount_value: number } | null;
    points?: number;
    /** Потолок списания баллами, % от суммы после промокода. */
    pointsMaxPercent?: number;
    gift?: number | null;
  },
): { promo: number; points: number; gift: number; total: number } {
  const promo = d.promo ? computePromoDiscount(subtotal, d.promo) : 0;
  const afterPromo = subtotal - promo;
  const points = d.points ? computePointsDiscount(afterPromo, d.points, d.pointsMaxPercent) : 0;
  const afterPoints = afterPromo - points;
  const gift = d.gift ? computeGiftDiscount(afterPoints, d.gift) : 0;
  return { promo, points, gift, total: Math.max(0, afterPoints - gift) };
}
