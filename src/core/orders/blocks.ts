/**
 * Какие блоки показывать на карточке заказа в новом виде (З4). Условия те
 * же, что были на странице заказа, собраны в одном месте: подарок и
 * согласование стоят, только если они есть в заказе, остальное зависит от
 * вида заказа, статуса и права правки.
 */
const IN_WORK = ["accepted", "in_production", "ready"];
const CLOSED = ["delivered", "rejected", "cancelled", "refunded"];

export type OrderBlocksInput = {
  status: string;
  fulfillment_kind: string;
  editable: boolean;
  /** Модуль «курьер» включён у магазина. */
  courierModule: boolean;
  hasGift: boolean;
  /** Статус согласования фото: «none» — не отправлялось. */
  approvalStatus: string;
  hasCourier: boolean;
};

export type OrderBlocks = {
  gift: boolean;
  /** Блок согласования: показан ли и можно ли отправить новое фото. */
  approval: { show: boolean; editable: boolean };
  courier: { show: boolean; editable: boolean };
  /** Правка получения (дата, адрес, зона): только физический не закрытый заказ. */
  fulfillmentEditor: boolean;
  /** Заметка продавца: её правит тот, кто может править. */
  note: boolean;
};

export function orderBlocks(i: OrderBlocksInput): OrderBlocks {
  const physical = i.fulfillment_kind === "physical";
  const inWork = IN_WORK.includes(i.status);
  const canWork = i.editable && inWork;
  return {
    gift: i.hasGift,
    approval: {
      show: physical && (i.approvalStatus !== "none" || canWork),
      editable: canWork,
    },
    courier: {
      show: physical && (i.hasCourier || (i.courierModule && canWork)),
      editable: i.courierModule && canWork,
    },
    fulfillmentEditor: i.editable && physical && !CLOSED.includes(i.status),
    note: i.editable,
  };
}
