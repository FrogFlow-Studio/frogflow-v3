import { describe, expect, it } from "vitest";
import { closedHandover, defaultHandoverStep, handoverAllowed, handoverSteps } from "./handover";
import { mainAction } from "./steps";

describe("«Отправлен» и «Выдан» по способу получения", () => {
  it("доставка — только «Отправлен», самовывоз — только «Выдан»", () => {
    expect(handoverSteps("delivery")).toEqual(["shipped"]);
    expect(handoverSteps("pickup")).toEqual(["done"]);
    expect(handoverAllowed("delivery", "done")).toBe(false);
    expect(handoverAllowed("pickup", "shipped")).toBe(false);
  });

  it("старый заказ без способа получения: допустимы оба, по умолчанию «Выдан»", () => {
    expect(handoverSteps(null)).toEqual(["shipped", "done"]);
    expect(handoverSteps(undefined)).toEqual(["shipped", "done"]);
    expect(defaultHandoverStep(null)).toBe("done");
    expect(defaultHandoverStep("pickup")).toBe("done");
    expect(defaultHandoverStep("delivery")).toBe("shipped");
  });

  it("закрытый заказ читается по последнему событию; без шага — «Выдан»", () => {
    const e = (to: string, step?: string) => ({
      kind: "status" as const,
      payload: { to, ...(step ? { step } : {}) },
    });
    expect(closedHandover([])).toBe("done");
    expect(closedHandover([e("delivered")])).toBe("done");
    expect(closedHandover([e("delivered", "shipped")])).toBe("shipped");
    expect(closedHandover([e("ready"), e("delivered", "done")])).toBe("done");
  });

  it("главная кнопка из «готов»: у доставки «Отправлен», иначе «Выдан»", () => {
    const o = (fulfillment_type: string | null) => ({
      status: "ready",
      fulfillment_kind: "physical",
      fulfillment_type,
    });
    expect(mainAction(o("delivery"), true)?.label).toBe("order.toShipped");
    expect(mainAction(o("pickup"), true)?.label).toBe("order.toDelivered");
    expect(mainAction(o(null), true)?.label).toBe("order.toDelivered");
  });
});
