import { describe, expect, it } from "vitest";
import { firstWeekState, type FirstWeekFacts } from "./first-week";

const none: FirstWeekFacts = {
  activeProducts: 0,
  paymentReady: false,
  buyersBesideSeller: 0,
  trialPassed: false,
  paidOrders: 0,
};

describe("первые 7 дней: пункты закрываются по данным", () => {
  it("пустой магазин: ничего не сделано, следующий шаг — товар, карточка видна", () => {
    const s = firstWeekState(none);
    expect(s).toMatchObject({ doneCount: 0, percent: 0, next: "product", visible: true });
  });

  it("каждый факт закрывает ровно свой пункт", () => {
    const only = (patch: Partial<FirstWeekFacts>) =>
      firstWeekState({ ...none, ...patch })
        .rows.filter((r) => r.done)
        .map((r) => r.step);
    expect(only({ activeProducts: 1 })).toEqual(["product"]);
    expect(only({ paymentReady: true })).toEqual(["payment"]);
    expect(only({ buyersBesideSeller: 1 })).toEqual(["link"]);
    expect(only({ trialPassed: true })).toEqual(["trial"]);
  });

  it("следующий шаг идёт по порядку, а не по последнему сделанному", () => {
    expect(firstWeekState({ ...none, activeProducts: 3, trialPassed: true }).next).toBe("payment");
  });

  it("на 100% карточка уходит", () => {
    const s = firstWeekState({
      activeProducts: 2,
      paymentReady: true,
      buyersBesideSeller: 4,
      trialPassed: true,
      paidOrders: 0,
    });
    expect(s).toMatchObject({ percent: 100, next: null, visible: false });
  });

  it("настоящая оплата закрывает всё сразу: она доказывает товар, оплату, покупателя и путь", () => {
    const s = firstWeekState({ ...none, paidOrders: 1 });
    expect(s).toMatchObject({ percent: 100, visible: false, sold: true });
  });
});
