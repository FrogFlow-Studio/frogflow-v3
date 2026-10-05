import { describe, expect, it } from "vitest";
import { orderActions } from "./actions";
import { mainAction, moreActions, orderSteps, stepsFor } from "./steps";

const phys = (status: string) => ({ status, fulfillment_kind: "physical" });
const dig = (status: string) => ({ status, fulfillment_kind: "digital" });
const states = (o: { status: string; fulfillment_kind: string }) =>
  orderSteps(o).steps.map((s) => `${s.key}:${s.state}`);

describe("шаги статуса заказа", () => {
  it("у физического пять шагов, у цифрового три", () => {
    expect(stepsFor("physical")).toEqual(["new", "review", "work", "ready", "done"]);
    expect(stepsFor("digital")).toEqual(["new", "review", "done"]);
  });

  it("физический: текущий шаг по статусу, пройденные позади", () => {
    expect(states(phys("awaiting_payment"))).toEqual([
      "new:current",
      "review:todo",
      "work:todo",
      "ready:todo",
      "done:todo",
    ]);
    expect(states(phys("awaiting_confirmation"))[1]).toBe("review:current");
    expect(states(phys("accepted"))).toEqual([
      "new:done",
      "review:done",
      "work:current",
      "ready:todo",
      "done:todo",
    ]);
    expect(states(phys("in_production"))[2]).toBe("work:current");
    expect(states(phys("ready"))).toEqual([
      "new:done",
      "review:done",
      "work:done",
      "ready:current",
      "done:todo",
    ]);
  });

  it("выданный заказ — все шаги пройдены", () => {
    expect(states(phys("delivered")).every((s) => s.endsWith(":done"))).toBe(true);
    expect(states(dig("delivered"))).toEqual(["new:done", "review:done", "done:done"]);
  });

  it("отклонённый, отменённый и возвращённый — закрыт, шагов в работе нет", () => {
    for (const s of ["rejected", "cancelled", "refunded"]) {
      const v = orderSteps(phys(s));
      expect(v.closed).toBe(true);
      expect(v.steps.every((x) => x.state === "todo")).toBe(true);
    }
    expect(orderSteps(phys("accepted")).closed).toBe(false);
  });
});

describe("главная кнопка по статусу", () => {
  it("совпадает с первым допустимым действием и подписью шага", () => {
    expect(mainAction(dig("awaiting_confirmation"), true)).toEqual({
      action: "confirm",
      label: "order.confirmDeliver",
    });
    expect(mainAction(phys("awaiting_payment"), true)).toEqual({
      action: "confirm",
      label: "order.acceptPhysical",
    });
    expect(mainAction(phys("accepted"), true)).toEqual({
      action: "next",
      label: "order.toProduction",
    });
    expect(mainAction(phys("in_production"), true)).toEqual({
      action: "next",
      label: "order.toReady",
    });
    expect(mainAction(phys("ready"), true)).toEqual({ action: "next", label: "order.toDelivered" });
  });

  it("выданный, закрытый заказ и роль без права правки — кнопки нет", () => {
    for (const s of ["delivered", "rejected", "cancelled", "refunded"]) {
      expect(mainAction(phys(s), true)).toBeNull();
      expect(mainAction(dig(s), true)).toBeNull();
    }
    for (const s of ["awaiting_payment", "awaiting_confirmation", "accepted", "ready"])
      expect(mainAction(phys(s), false)).toBeNull();
  });

  it("цифровой принятый заказ шагов сборки не получает: главной кнопки нет, остаётся отклонить", () => {
    expect(mainAction(dig("accepted"), true)).toBeNull();
    expect(moreActions(dig("accepted"), true)).toEqual(["reject"]);
  });

  it("главная и «Ещё» вместе — ровно допустимые действия, без повторов и лишнего", () => {
    for (const s of [
      "awaiting_payment",
      "awaiting_confirmation",
      "paid",
      "accepted",
      "in_production",
      "ready",
      "delivered",
      "rejected",
    ]) {
      for (const o of [phys(s), dig(s)]) {
        const main = mainAction(o, true);
        const all = [...(main ? [main.action] : []), ...moreActions(o, true)];
        expect([...all].sort()).toEqual([...orderActions(o, true)].sort());
        expect(new Set(all).size).toBe(all.length);
      }
    }
  });

  it("«Ещё» хранит назад, напомнить и отклонить, а не главное действие", () => {
    expect(moreActions(phys("in_production"), true)).toEqual(["prev", "reject"]);
    expect(moreActions(phys("awaiting_payment"), true)).toEqual(["remind", "reject"]);
  });
});
