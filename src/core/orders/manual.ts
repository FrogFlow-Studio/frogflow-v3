import { createHash, randomUUID } from "node:crypto";

/**
 * Заказ, который продавец заводит сам: звонок, комментарий в Instagram,
 * переписка мимо бота. Покупателя в Telegram нет — нужен синтетический
 * отрицательный telegram_id (как у Instagram/WhatsApp), чтобы не пересечься
 * с настоящими чатами и не попасть в рассылку.
 *
 * Один и тот же телефон схлопывается в одного покупателя (история, LTV).
 * Без телефона каждая запись — отдельный человек: иначе все безымянные
 * заказы склеились бы в одну строку клиентской базы.
 */
export function manualCustomerKey(contact: string | null | undefined, entropy?: string): string {
  const digits = (contact ?? "").replace(/\D/g, "");
  const normalized = digits.length >= 10 ? digits.slice(-10) : digits;
  if (normalized.length >= 7) return normalized;
  return entropy ?? randomUUID();
}

export function manualCustomerTelegramId(
  contact: string | null | undefined,
  entropy?: string,
): number {
  const hex = createHash("sha256")
    .update(`manual:${manualCustomerKey(contact, entropy)}`)
    .digest("hex")
    .slice(0, 13);
  return -parseInt(hex, 16);
}

export function manualCustomerUserKey(
  contact: string | null | undefined,
  entropy?: string,
): string {
  return `manual:${manualCustomerKey(contact, entropy)}`;
}

export function manualOrderTotal(lineAmounts: number[], deliveryFee: number): number {
  const items = lineAmounts.reduce((sum, n) => sum + (Number(n) || 0), 0);
  return Math.max(0, items + (Number(deliveryFee) || 0));
}

/** Деньги уже приняты (наличные, перевод) — сразу в работу, иначе ждём оплату. */
export function manualOrderStatus(paidAmount: number): "accepted" | "awaiting_payment" {
  return paidAmount > 0 ? "accepted" : "awaiting_payment";
}
