import { orderActions, type OrderActionKey } from "./actions";

/**
 * Шаги статуса заказа в новом виде карточки (З2): Новый → Чек на проверке →
 * В работе → Готов → Выдан. Статусы базы не меняются, шаг — только способ
 * показать их. Главная кнопка берётся из `orderActions` — того же списка, по
 * которому сервер решает, какие переходы допустимы, поэтому недопустимый
 * переход не рисуется и всё равно будет отклонён сервером.
 */
export const ORDER_STEP_KEYS = ["new", "review", "work", "ready", "done"] as const;
export type OrderStepKey = (typeof ORDER_STEP_KEYS)[number];

const STEP_OF: Record<string, OrderStepKey> = {
  awaiting_payment: "new",
  paid: "new",
  awaiting_confirmation: "review",
  accepted: "work",
  in_production: "work",
  ready: "ready",
  delivering: "done",
  delivered: "done",
  completed: "done",
};

/** Закрытые заказы: шагов нет, показываем итог. */
export const CLOSED_STATUSES = ["rejected", "cancelled", "refunded"] as const;

/** Шаги заказа: у цифрового нет «В работе» и «Готов». */
export function stepsFor(kind: string): OrderStepKey[] {
  return kind === "physical"
    ? [...ORDER_STEP_KEYS]
    : ORDER_STEP_KEYS.filter((s) => s !== "work" && s !== "ready");
}

export type OrderStepsView = {
  steps: Array<{ key: OrderStepKey; state: "done" | "current" | "todo" }>;
  /** Закрыт без выдачи (отклонён, отменён, возвращён) — шаги не рисуются. */
  closed: boolean;
};

export function orderSteps(o: { status: string; fulfillment_kind: string }): OrderStepsView {
  const keys = stepsFor(o.fulfillment_kind);
  if ((CLOSED_STATUSES as readonly string[]).includes(o.status)) {
    return { steps: keys.map((key) => ({ key, state: "todo" as const })), closed: true };
  }
  const cur: OrderStepKey = STEP_OF[o.status] ?? "new";
  const at = Math.max(0, keys.indexOf(cur));
  return {
    steps: keys.map((key, i) => ({
      key,
      // Выданный заказ — все шаги пройдены, текущего нет.
      state: cur === "done" || i < at ? "done" : i === at ? "current" : "todo",
    })),
    closed: false,
  };
}

/** Подпись главной кнопки: ключ строки админки. */
export type MainActionLabel =
  | "order.acceptPhysical"
  | "order.confirmDeliver"
  | "order.toProduction"
  | "order.toReady"
  | "order.toDelivered";

export type MainAction = { action: "confirm" | "next"; label: MainActionLabel };

/** Одна главная кнопка по статусу; нет допустимого действия (или нет права правки) — null. */
export function mainAction(
  o: { status: string; fulfillment_kind: string },
  editable: boolean,
): MainAction | null {
  const actions = orderActions(o, editable);
  if (actions.includes("confirm"))
    return {
      action: "confirm",
      label: o.fulfillment_kind === "physical" ? "order.acceptPhysical" : "order.confirmDeliver",
    };
  if (actions.includes("next"))
    return {
      action: "next",
      label:
        o.status === "accepted"
          ? "order.toProduction"
          : o.status === "in_production"
            ? "order.toReady"
            : "order.toDelivered",
    };
  return null;
}

/** Прочие действия под «Ещё»: всё допустимое, кроме главной кнопки. */
export function moreActions(
  o: { status: string; fulfillment_kind: string },
  editable: boolean,
): OrderActionKey[] {
  const main = mainAction(o, editable);
  return orderActions(o, editable).filter((a) => a !== main?.action);
}
