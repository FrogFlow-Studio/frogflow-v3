/**
 * Перенос даты заказа в админке (seed/shop15-reschedule.ts, shop15-reschedule.spec.ts):
 * магазин «Пекарня В15» — воскресенье без выдачи, лимит один заказ на день; один заказ
 * на ближайший понедельник через неделю и занятый вторник.
 */
export const RESCHED15_SHOP_ID = "e2e00000-0000-4000-8000-00000000fc00";
export const RESCHED15_SHOP_NAME = "Пекарня В15";
export const RESCHED15_ORDER_ID = 15001;
export const RESCHED15_BUSY_ORDER_ID = 15002;
export const RESCHED15_SELLER_LOGIN = "e2e_resched15";
export const RESCHED15_SELLER_PASSWORD = "e2e-resched15-pass-123";
/** Первая дата с днём недели `dow` (0 — воскресенье) не раньше чем через `from` дней, YYYY-MM-DD. */
export function reschedDay(dow: number, from: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + from);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** Заказ стоит на понедельник, занятый день — вторник, нерабочий — воскресенье. */
export const reschedOrderDay = () => reschedDay(1, 10);
export const reschedBusyDay = () => reschedDay(2, 10);
export const reschedClosedDay = () => reschedDay(0, 10);
export const reschedFreeDay = () => reschedDay(3, 10);
