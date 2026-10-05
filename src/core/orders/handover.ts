import type { OrderEvent } from "./events";

/**
 * «Отправлен» и «Выдан» (Х4). В базе у закрытого физического заказа один
 * статус `delivered` — общий с прежней платформой, схема не меняется. Различие
 * держит шаг в событии `status` (`step`) и способ получения заказа:
 * доставка закрывается «Отправлен» (покупателю уходит сообщение об отправке),
 * самовывоз — «Выдан». У заказа без способа получения (старые заказы, ручные
 * счета) допустимы оба, как было до разделения.
 */
export type HandoverStep = "shipped" | "done";

/** Какие закрывающие шаги допустимы для способа получения. */
export function handoverSteps(type: string | null | undefined): HandoverStep[] {
  if (type === "delivery") return ["shipped"];
  if (type === "pickup") return ["done"];
  return ["shipped", "done"];
}

export function handoverAllowed(type: string | null | undefined, step: HandoverStep): boolean {
  return handoverSteps(type).includes(step);
}

/** Шаг по умолчанию для кнопки «дальше» из статуса «готов»: доставка — отправка, остальное — выдача. */
export function defaultHandoverStep(type: string | null | undefined): HandoverStep {
  return type === "delivery" ? "shipped" : "done";
}

/**
 * Каким шагом заказ закрыт: по последнему событию `status` с `to = delivered`.
 * Нет события или в нём нет шага (заказ закрыт до разделения) — «Выдан».
 */
export function closedHandover(events: Array<Pick<OrderEvent, "kind" | "payload">>): HandoverStep {
  let step: HandoverStep = "done";
  for (const e of events)
    if (e.kind === "status" && e.payload.to === "delivered")
      step = e.payload.step === "shipped" ? "shipped" : "done";
  return step;
}
