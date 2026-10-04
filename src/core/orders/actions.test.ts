import { describe, expect, it } from "vitest";
import { orderActions } from "./actions";

const phys = (status: string) => ({ status, fulfillment_kind: "physical" });
const dig = (status: string) => ({ status, fulfillment_kind: "digital" });

describe("кнопки карточки заказа", () => {
  it("чек на проверке: принять и отклонить", () => {
    expect(orderActions(dig("awaiting_confirmation"), true)).toEqual(["confirm", "reject"]);
  });
  it("ждёт оплаты: принять, напомнить, отклонить", () => {
    expect(orderActions(phys("awaiting_payment"), true)).toEqual(["confirm", "remind", "reject"]);
  });
  it("физический: принят → в работу; в работе и готов — вперёд и назад", () => {
    expect(orderActions(phys("accepted"), true)).toEqual(["next", "reject"]);
    expect(orderActions(phys("in_production"), true)).toEqual(["next", "prev", "reject"]);
    expect(orderActions(phys("ready"), true)).toEqual(["next", "prev", "reject"]);
  });
  it("цифровой принятый заказ шагов сборки не получает", () => {
    expect(orderActions(dig("accepted"), true)).toEqual(["reject"]);
  });
  it("выданный, отклонённый, возвращённый — кнопок нет", () => {
    for (const s of ["delivered", "rejected", "cancelled", "refunded"]) {
      expect(orderActions(phys(s), true)).toEqual([]);
      expect(orderActions(dig(s), true)).toEqual([]);
    }
  });
  it("без права правки (бухгалтер, просмотр) кнопок нет ни в одном статусе", () => {
    for (const s of ["awaiting_payment", "awaiting_confirmation", "accepted", "ready"])
      expect(orderActions(phys(s), false)).toEqual([]);
  });
});
