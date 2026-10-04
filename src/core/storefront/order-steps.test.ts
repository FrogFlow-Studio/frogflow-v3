import { describe, expect, it } from "vitest";
import { orderSteps } from "./order-steps";

const states = (status: string, physical: boolean) =>
  orderSteps(status, physical).map((s) => `${s.key}:${s.state}`);

describe("шаги заказа на странице статуса", () => {
  it("цифровой: «оплата подтверждена» только у оплаченного", () => {
    expect(states("awaiting_payment", false)).toEqual([
      "placed:current",
      "paid:todo",
      "issued:todo",
    ]);
    expect(states("awaiting_confirmation", false)).toEqual([
      "placed:current",
      "paid:todo",
      "issued:todo",
    ]);
    expect(states("paid", false)).toEqual(["placed:done", "paid:current", "issued:todo"]);
    expect(states("delivering", false)).toEqual(["placed:done", "paid:done", "issued:current"]);
    expect(states("delivered", false)).toEqual(["placed:done", "paid:done", "issued:done"]);
  });

  it("физический: шаги идут от оформления до получения, оплату по шагам не обещаем", () => {
    expect(states("awaiting_payment", true)).toEqual([
      "placed:current",
      "working:todo",
      "ready:todo",
      "received:todo",
    ]);
    for (const s of ["paid", "accepted", "in_production"])
      expect(states(s, true)).toEqual([
        "placed:done",
        "working:current",
        "ready:todo",
        "received:todo",
      ]);
    expect(states("ready", true)).toEqual([
      "placed:done",
      "working:done",
      "ready:current",
      "received:todo",
    ]);
    expect(states("delivered", true).every((s) => s.endsWith(":done"))).toBe(true);
    expect(orderSteps("paid", true).some((s) => s.key === "paid")).toBe(false);
  });

  it("цифровой заказ, принятый продавцом без оплаты, не получает отметку «оплачено»", () => {
    expect(states("accepted", false)).toEqual(["placed:current", "paid:todo", "issued:todo"]);
  });

  it("отклонён, отменён, возвращён — шагов нет", () => {
    for (const s of ["rejected", "cancelled", "refunded"]) {
      expect(orderSteps(s, true)).toEqual([]);
      expect(orderSteps(s, false)).toEqual([]);
    }
  });
});
