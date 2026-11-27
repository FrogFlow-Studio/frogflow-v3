import { describe, expect, it } from "vitest";
import { v4PaidFacts } from "./gateway-facts";

const ORDER = "aaaaaaaa-0000-4000-8000-0000000000a1";

describe("факты оплаты v4", () => {
  it("берёт uuid заказа и сумму, числовой номер v3 пропускает", () => {
    expect(
      v4PaidFacts({
        id: "evt_1",
        data: { object: { metadata: { order_id: "274" }, amount_total: 100_000, currency: "kzt" } },
      }),
    ).toBeNull();
    expect(
      v4PaidFacts({
        id: "evt_1",
        payment_intent: "pi_1",
        data: {
          object: {
            metadata: { v4_order_id: ORDER },
            amount_total: 100_000,
            currency: "kzt",
          },
        },
      }),
    ).toEqual({
      orderId: ORDER,
      amountMinor: 100_000,
      currency: "KZT",
      externalRef: "pi_1",
    });
  });
});
