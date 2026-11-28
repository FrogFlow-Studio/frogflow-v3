import { describe, expect, it } from "vitest";
import { catalogCard, deliverPlan, productCard, voiceCard } from "@/v4/channels/card";
import { emptyDraft, pressCheckout, typeCheckout } from "@/v4/channels/checkout-card";
import type { CheckoutShop } from "@/v4/channels/checkout-card";

/**
 * Золотой путь магазина на кнопках, без модели. Откуда: план v4 «боты на
 * кнопках» — каталог, товар, оплата и адрес одними нажатиями, правка не
 * оставляет вторую карточку.
 */

const shop: CheckoutShop = {
  physical: true,
  flowers: false,
  countries: [
    { id: "KZ", label: { ru: "Казахстан", kk: "Қазақстан", en: "Kazakhstan", uz: "Qozog'iston" } },
  ],
  payMethods: [{ id: "kaspi", label: { ru: "Kaspi", kk: "Kaspi", en: "Kaspi", uz: "Kaspi" } }],
  zones: [{ id: "center", label: { ru: "Центр", kk: "Орталық", en: "Centre", uz: "Markaz" } }],
  dates: ["2026-12-01"],
  minDate: "2026-12-01",
};

describe("диалог v4: магазин на кнопках", () => {
  it("каталог правится, товар покупается кнопками, голос заказ не ставит", () => {
    const items = [
      { id: "a", title: "Палитра" },
      { id: "b", title: "Тетрадь" },
    ];
    const opens = [deliverPlan("telegram", catalogCard({ items, page: 0 }), null)];
    const held = "m1";
    const turned = deliverPlan("telegram", catalogCard({ items, page: 1 }), held);
    expect(opens[0]?.op).toBe("send");
    expect(turned.op).toBe("edit");
    const product = productCard({
      title: "Тетрадь",
      totalMinor: 170000,
      currency: "KZT",
      offerId: "ABCDEFGH",
      photoUrl: "https://cdn.test/t.jpg",
    });
    expect(product.buttons.some((b) => b.data === "offer:ABCDEFGH")).toBe(true);
    expect(product.photoUrl).toBeTruthy();
    let view = pressCheckout(emptyDraft(), "lang:ru", shop);
    view = pressCheckout(view.draft, "country:KZ", shop);
    view = pressCheckout(view.draft, "pay:kaspi", shop);
    view = pressCheckout(view.draft, "get:delivery", shop);
    view = pressCheckout(view.draft, "date:2026-12-01", shop);
    view = pressCheckout(view.draft, "zone:center", shop);
    view = typeCheckout(view.draft, "Абая 1", shop);
    expect(view.done).toBe(true);
    expect(view.draft.payMethod).toBe("kaspi");
    expect(voiceCard().buttons).toEqual([]);
  });
});
