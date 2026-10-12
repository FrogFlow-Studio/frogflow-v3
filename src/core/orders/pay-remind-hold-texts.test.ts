import { describe, expect, it } from "vitest";
import { payRemindHeldText } from "./pay-remind-hold-texts";

describe("подсказка продавцу: напоминание придержано", () => {
  it("обращение: номер заказа, обращения, покупатель, что сделать и ссылка", () => {
    const t = payRemindHeldText(
      "ru",
      144,
      { reason: "ticket", ticket: 124 },
      "@gritsevichnadezhda",
      "https://shop.test/admin/orders/9",
    );
    expect(t).toContain("Заказ №144: напоминание об оплате не отправлено");
    expect(t).toContain("обращение #124");
    expect(t).toContain("@gritsevichnadezhda");
    expect(t).toContain("Отмените заказ или подтвердите оплату.");
    expect(t).toContain("https://shop.test/admin/orders/9");
  });

  it("более поздний заказ и все четыре языка", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const t = payRemindHeldText(l, 143, { reason: "later_order", laterNo: 145 }, "—", "x");
      expect(t).toContain("143");
      expect(t).toContain("145");
    }
    expect(payRemindHeldText("en", 1, { reason: "ticket", ticket: 2 }, "—", "x")).toContain(
      "Cancel the order or confirm the payment.",
    );
  });
});
