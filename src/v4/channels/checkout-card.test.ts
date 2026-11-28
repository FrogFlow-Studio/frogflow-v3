import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDraft, pressCheckout, typeCheckout, type CheckoutShop } from "./checkout-card";

const shop = (over: Partial<CheckoutShop> = {}): CheckoutShop => ({
  physical: false,
  flowers: false,
  countries: [
    { id: "KZ", label: { ru: "Казахстан", kk: "Қазақстан", en: "Kazakhstan", uz: "Qozog'iston" } },
  ],
  payMethods: [{ id: "kaspi", label: { ru: "Kaspi", kk: "Kaspi", en: "Kaspi", uz: "Kaspi" } }],
  zones: [{ id: "center", label: { ru: "Центр", kk: "Орталық", en: "Centre", uz: "Markaz" } }],
  dates: ["2026-12-01", "2026-11-01"],
  minDate: "2026-12-01",
  ...over,
});

describe("оформление кнопками", () => {
  it("цифровой товар: язык, страна, оплата — и больше печатать не нужно", () => {
    let view = pressCheckout(emptyDraft(), "lang:en", shop());
    expect(view.card.text).toBe("Country");
    view = pressCheckout(view.draft, "country:KZ", shop());
    view = pressCheckout(view.draft, "pay:kaspi", shop());
    expect(view.done).toBe(true);
    expect(view.needText).toBe(false);
    const ignored = typeCheckout(view.draft, "улица 1", shop());
    expect(ignored.draft.address).toBeNull();
  });

  it("доставка: дата не раньше срока, адрес — одно сообщение, цветы держат свои поля", () => {
    const physical = shop({ physical: true, flowers: true });
    let view = pressCheckout(emptyDraft(), "lang:ru", physical);
    view = pressCheckout(view.draft, "country:KZ", physical);
    view = pressCheckout(view.draft, "pay:kaspi", physical);
    view = pressCheckout(view.draft, "get:delivery", physical);
    view = pressCheckout(view.draft, "urgent:later", physical);
    view = pressCheckout(view.draft, "slot:evening", physical);
    view = pressCheckout(view.draft, "date:2026-11-01", physical);
    expect(view.draft.date).toBeNull();
    view = pressCheckout(view.draft, "date:2026-12-01", physical);
    view = pressCheckout(view.draft, "zone:center", physical);
    expect(view.needText).toBe(true);
    view = typeCheckout(view.draft, "Абая 1, открытка маме", physical);
    expect(view.done).toBe(true);
    expect(view.draft.address).toBe("Абая 1, открытка маме");
    expect(view.draft.urgency).toBe("later");
    expect(view.draft.slot).toBe("evening");
  });

  it("человек открывает дело, кнопки оплаты остаются", () => {
    const view = pressCheckout(emptyDraft(), "human", shop());
    expect(view.handoff).toBe(true);
    expect(view.card.buttons.some((b) => b.data.startsWith("lang:"))).toBe(true);
  });

  it("в исходнике нет режимов awaiting_", () => {
    const src = readFileSync("src/v4/channels/checkout-card.ts", "utf8");
    expect(src).not.toMatch(/awaiting_/);
  });
});
