import { describe, expect, it } from "vitest";
import { fulfillmentLine } from "./admin-notify";
import type { OrderWithItems } from "@/core/orders/orders";

const order = (o: Record<string, unknown>) => o as unknown as OrderWithItems;

describe("уведомление продавцу: как получить физический заказ", () => {
  it("доставка: дата, зона и адрес, комментарий", () => {
    expect(
      fulfillmentLine(
        order({
          fulfillment_kind: "physical",
          fulfillment_type: "delivery",
          fulfillment_at: "2026-10-02T00:00:00Z",
          delivery_zone_name: "Центр",
          fulfillment_address: "Абая <1>",
          fulfillment_note: "домофон 12",
        }),
      ),
    ).toBe("🚚 Доставка: 02.10.2026\n📍 Центр, Абая &lt;1&gt;\n💬 домофон 12\n");
  });

  it("самовывоз без адреса; цифровой заказ — пусто", () => {
    expect(
      fulfillmentLine(
        order({ fulfillment_kind: "physical", fulfillment_type: "pickup", fulfillment_at: null }),
      ),
    ).toBe("🏪 Самовывоз: —\n");
    expect(fulfillmentLine(order({ fulfillment_kind: "digital" }))).toBe("");
  });
});
