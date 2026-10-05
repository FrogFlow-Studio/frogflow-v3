import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { giftCodeMail, orderMaterialsMail, orderNoticeMail, unpaidOrderMail } from "./mail.server";

/**
 * Обновление nodemailer (10.0.14): каждое письмо платформы проходит через настоящую
 * библиотеку (транспорт `jsonTransport` собирает письмо целиком, но в сеть не ходит) —
 * тема, текст и HTML доходят без потерь и без перевода строк в заголовках.
 */
describe("все шаблоны писем собираются настоящим nodemailer", () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const send = async (m: { subject: string; text: string; html: string }) =>
    JSON.parse(
      String(
        (await transport.sendMail({ from: "shop@example.com", to: "buyer@example.com", ...m }))
          .message,
      ),
    ) as { subject: string; text: string; html: string; to: { address: string }[] };

  const mails = {
    материалы: orderMaterialsMail({
      orderNo: 15,
      shopName: "Магазин",
      files: [{ name: "Пазлы.pdf", url: "https://x/y?a=1&b=2" }],
      linkDays: 7,
    }),
    "неоплаченный заказ": unpaidOrderMail({
      orderNo: 16,
      shopName: "Магазин",
      amount: "5 000 ₸",
      url: "https://x/o/1",
      hoursLeft: 24,
    }),
    "уведомление о заказе": orderNoticeMail({
      orderNo: 17,
      shopName: "Магазин\r\nBcc: evil@example.com",
      notice: "<b>Оплачен</b>",
      url: "https://x/o/1",
    }),
    ...Object.fromEntries(
      (["ru", "kk", "en", "uz"] as const).map((locale) => [
        `сертификат ${locale}`,
        giftCodeMail({
          orderNo: 18,
          shopName: "Магазин",
          code: "GIFT-1234",
          amount: "10 000 ₸",
          shopUrl: "https://x",
          locale,
        }),
      ]),
    ),
  };

  for (const [name, mail] of Object.entries(mails))
    it(`${name}: тема, текст и HTML без потерь`, async () => {
      const sent = await send(mail);
      expect(sent.subject).toBe(mail.subject);
      expect(sent.text).toBe(mail.text);
      expect(sent.html).toBe(mail.html);
      expect(sent.to[0]?.address).toBe("buyer@example.com");
      expect(sent.subject).not.toMatch(/[\r\n]/);
    });
});
