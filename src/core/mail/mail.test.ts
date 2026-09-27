import { describe, expect, it } from "vitest";
import { orderMaterialsMail, orderNoticeMail } from "./mail.server";

describe("письмо с материалами", () => {
  it("содержит номер, ссылки, срок и экранирует HTML", () => {
    const m = orderMaterialsMail({
      orderNo: 15,
      shopName: "Магазин <Демо>",
      files: [{ name: "Пазлы.pdf", url: "https://x/y?a=1&b=2" }],
      linkDays: 7,
    });
    expect(m.subject).toContain("№15");
    expect(m.text).toContain("Материал доступен по ссылке");
    expect(m.text).toContain("https://x/y?a=1&b=2");
    expect(m.html).toContain("&amp;b=2");
    expect(m.html).toContain("Магазин &lt;Демо&gt;");
    expect(m.text).toContain("7 дней");
  });
});

describe("письмо-уведомление о заказе", () => {
  it("перевод строки в названии магазина не попадает в тему", () => {
    const m = orderNoticeMail({
      orderNo: 5,
      shopName: "Shop\r\nBcc: x@y.z",
      notice: "Заказ готов",
      url: "https://app.test/s/a/order/1?t=x",
    });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe("Заказ №5 в магазине «Shop Bcc: x@y.z»");
  });
});
