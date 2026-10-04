/**
 * Какие кнопки действий показывать на карточке заказа: только допустимые
 * переходы статуса. Один источник для страницы и для теста — «Выдан» не
 * рисуется у выданного заказа, «Принять» — у принятого.
 */
export type OrderActionKey = "confirm" | "next" | "prev" | "remind" | "reject";

const PENDING = ["awaiting_payment", "awaiting_confirmation", "paid"];
const IN_WORK = ["accepted", "in_production", "ready"];

export function orderActions(
  o: { status: string; fulfillment_kind: string },
  editable: boolean,
): OrderActionKey[] {
  // Бухгалтер и «просмотр» ничего не меняют (сервер всё равно откажет).
  if (!editable) return [];
  const physical = o.fulfillment_kind === "physical";
  const out: OrderActionKey[] = [];
  if (PENDING.includes(o.status)) out.push("confirm");
  if (physical && IN_WORK.includes(o.status)) out.push("next");
  if (physical && (o.status === "in_production" || o.status === "ready")) out.push("prev");
  if (o.status === "awaiting_payment") out.push("remind");
  if (PENDING.includes(o.status) || IN_WORK.includes(o.status)) out.push("reject");
  return out;
}
