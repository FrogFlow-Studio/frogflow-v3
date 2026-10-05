/**
 * Шаги заказа на странице «где мой заказ». Физический заказ: оформлен → в работе
 * → готов или в пути → получен. Цифровой: оформлен → оплата подтверждена →
 * материалы выданы. «Оплата подтверждена» только у цифрового и только когда
 * заказ действительно оплачен (paid, выдаётся, выдан): у физического оплата
 * бывает и при получении, поэтому страница о ней по шагам не говорит —
 * сумму и статус оплаты показывает сам заказ. Отклонённый, отменённый и
 * возвращённый заказ шагов не имеет: его статус виден текстом.
 */
export type OrderStepKey =
  "placed" | "working" | "ready" | "paid" | "received" | "shipped" | "issued";
export type OrderStep = { key: OrderStepKey; state: "done" | "current" | "todo" };

const TERMINAL = new Set(["rejected", "cancelled", "refunded"]);

const DIGITAL: OrderStepKey[] = ["placed", "paid", "issued"];
const PHYSICAL: OrderStepKey[] = ["placed", "working", "ready", "received"];
const PHYSICAL_SHIPPED: OrderStepKey[] = ["placed", "working", "ready", "shipped"];

/** Номер текущего шага; больше длины списка — всё выполнено. */
function position(status: string, physical: boolean): number {
  if (status === "delivered") return 99;
  if (status === "awaiting_payment" || status === "awaiting_confirmation") return 0;
  if (physical) {
    if (status === "ready" || status === "delivering") return 2;
    return 1; // paid, accepted, in_production
  }
  if (status === "delivering") return 2;
  // paid, accepted, in_production, ready — у цифрового заказа это «оплачено, выдаём»
  return status === "paid" ? 1 : 0;
}

/** Шаги заказа; пустой список — шагов нет (отменён, отклонён, возвращён). */
export function orderSteps(status: string, physical: boolean, delivery = false): OrderStep[] {
  if (TERMINAL.has(status)) return [];
  // Доставка закрывается «Отправлен», а не «Получен»: продавец не знает, дошла ли посылка (Х4).
  const keys = physical ? (delivery ? PHYSICAL_SHIPPED : PHYSICAL) : DIGITAL;
  const at = position(status, physical);
  return keys.map((key, i) => ({
    key,
    state: i < at ? "done" : i === at ? "current" : "todo",
  }));
}
