import { describe, expect, it } from "vitest";
import { giftCodeMail, orderMaterialsMail, orderNoticeMail } from "./mail.server";

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

describe("письмо с кодом сертификата", () => {
  const base = {
    orderNo: 12,
    shopName: "Прописи <1>",
    code: "ABCD2345",
    amount: "5 000 ₸",
    shopUrl: "https://shop.test/s/propisi",
  };

  it("по умолчанию на русском, имя магазина экранировано", () => {
    const m = giftCodeMail(base);
    expect(m.subject).toBe("Подарочный сертификат на 5 000 ₸ — заказ №12");
    expect(m.text).toContain("ABCD2345");
    expect(m.html).toContain("Прописи &lt;1&gt;");
    expect(m.html).toContain("Перейти в магазин");
  });

  it.each([
    ["kk", "сыйлық сертификаты", "Дүкенге өту"],
    ["en", "Gift certificate for 5 000 ₸", "Go to the shop"],
    ["uz", "sovg‘a sertifikati", "Do‘konga o‘tish"],
  ] as const)("на языке магазина: %s", (locale, subject, link) => {
    const m = giftCodeMail({ ...base, locale });
    expect(m.subject).toContain(subject);
    expect(m.html).toContain(link);
    expect(m.text).toContain("ABCD2345");
    expect(m.text).not.toMatch(/[Зз]дравствуйте/);
  });
});
