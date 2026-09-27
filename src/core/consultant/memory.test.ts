import { describe, expect, it } from "vitest";
import { formatProfile, isPurchaseHandoff, mergeProfile, parseProfile, phoneIn } from "./memory";

describe("память о покупателе", () => {
  it("новое поверх старого, пустое не стирает, чужие поля отброшены", () => {
    const p = mergeProfile(
      { size: "200x220", city: "Алматы" },
      { city: " ", color: "белый", x: 1 },
    );
    expect(p).toEqual({ size: "200x220", city: "Алматы", color: "белый" });
    expect(parseProfile("мусор")).toEqual({});
    // Телефон от модели разбирается так же строго, как в тексте покупателя.
    expect(mergeProfile({}, { phone: "850101300123" })).toEqual({});
    expect(mergeProfile({ phone: "+77011234567" }, { phone: "мой ИИН" })).toEqual({
      phone: "+77011234567",
    });
    expect(parseProfile({ phone: "+7 700 000 00 00", evil: "x" })).toEqual({
      phone: "+7 700 000 00 00",
    });
  });

  it("строка для данных диалога — по порядку полей", () => {
    expect(formatProfile({ city: "Астана", looking_for: "одеяло" })).toBe(
      "ищет: одеяло; город: Астана",
    );
    expect(formatProfile({})).toBe("");
  });

  it("телефон в тексте: с разделителями, но не размер и не цена", () => {
    expect(phoneIn("мой номер +7 (701) 123-45-67")).toBe("+7 (701) 123-45-67");
    expect(phoneIn("87011234567, Алматы")).toBe("87011234567");
    expect(phoneIn("одеяло 200x220 за 45 000")).toBeNull();
    expect(phoneIn("+998 90 123 45 67")).toBe("+998 90 123 45 67");
    // ИИН, карта, номер заказа — не телефон.
    expect(phoneIn("мой ИИН 850101300123")).toBeNull();
    expect(phoneIn("карта 4400 4301 2345 6789")).toBeNull();
    expect(phoneIn("карта 4400430123456789")).toBeNull();
    expect(phoneIn("заказ 1234567890")).toBeNull();
    expect(phoneIn("ИИН 850101300123, тел 8 701 123 45 67")).toBe("8 701 123 45 67");
  });

  it("контакт нужен перед покупкой и заявкой на заказ, не перед звонком", () => {
    expect(isPurchaseHandoff("handoff_to_manager", { reason: "purchase" })).toBe(true);
    expect(isPurchaseHandoff("handoff_to_manager", { reason: "complaint" })).toBe(false);
    expect(isPurchaseHandoff("record_order_lead", { lead_type: "order" })).toBe(true);
    expect(isPurchaseHandoff("record_order_lead", { lead_type: "call" })).toBe(false);
  });
});
