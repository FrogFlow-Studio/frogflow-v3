import { describe, expect, it } from "vitest";
import { orderBlocks, type OrderBlocksInput } from "./blocks";

const base: OrderBlocksInput = {
  status: "accepted",
  fulfillment_kind: "physical",
  editable: true,
  courierModule: true,
  hasGift: false,
  approvalStatus: "none",
  hasCourier: false,
};
const blocks = (over: Partial<OrderBlocksInput> = {}) => orderBlocks({ ...base, ...over });

describe("показ блоков карточки заказа по данным заказа", () => {
  it("подарок — только если он есть в заказе", () => {
    expect(blocks().gift).toBe(false);
    expect(blocks({ hasGift: true }).gift).toBe(true);
  });

  it("согласование: у цифрового нет; у физического в работе — можно отправить; после ответа остаётся видно", () => {
    expect(blocks({ fulfillment_kind: "digital" }).approval.show).toBe(false);
    expect(blocks().approval).toEqual({ show: true, editable: true });
    // Заказ ещё не принят: отправлять нечего и показывать нечего.
    expect(blocks({ status: "awaiting_payment" }).approval.show).toBe(false);
    // Фото уже согласовывали — блок виден и у выданного, но без отправки.
    expect(blocks({ status: "delivered", approvalStatus: "ok" }).approval).toEqual({
      show: true,
      editable: false,
    });
  });

  it("курьер: нужен модуль и работа с заказом; уже назначенный виден всегда", () => {
    expect(blocks().courier).toEqual({ show: true, editable: true });
    expect(blocks({ courierModule: false }).courier).toEqual({ show: false, editable: false });
    expect(blocks({ courierModule: false, hasCourier: true }).courier).toEqual({
      show: true,
      editable: false,
    });
    expect(blocks({ status: "delivered", hasCourier: true }).courier).toEqual({
      show: true,
      editable: false,
    });
    expect(blocks({ fulfillment_kind: "digital", hasCourier: true }).courier.show).toBe(false);
  });

  it("роль без права правки: ничего редактировать нельзя, ни заметки, ни получения", () => {
    const b = blocks({ editable: false, hasCourier: true, approvalStatus: "ok" });
    expect(b.note).toBe(false);
    expect(b.fulfillmentEditor).toBe(false);
    expect(b.approval.editable).toBe(false);
    expect(b.courier.editable).toBe(false);
    expect(b.approval.show).toBe(true);
    expect(b.courier.show).toBe(true);
  });

  it("правка получения: физический и не закрытый", () => {
    expect(blocks().fulfillmentEditor).toBe(true);
    for (const s of ["delivered", "rejected", "cancelled", "refunded"])
      expect(blocks({ status: s }).fulfillmentEditor).toBe(false);
    expect(blocks({ fulfillment_kind: "digital" }).fulfillmentEditor).toBe(false);
  });
});
