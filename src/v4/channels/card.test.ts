import { describe, expect, it } from "vitest";
import {
  afterEdit,
  catalogCard,
  deliverPlan,
  fitButtons,
  lessonCard,
  moneyWord,
  orderCard,
  productCard,
  reactionOrder,
  voiceCard,
} from "./card";

describe("карточка в чате", () => {
  it("товар: фото, цена, купить и назад; открыть — только если есть магазин", () => {
    const card = productCard({
      title: "Палитра",
      totalMinor: 170000,
      currency: "KZT",
      offerId: "ABCDEFGH",
      photoUrl: "https://cdn.test/p.jpg",
      productId: "11111111-1111-4111-8111-111111111111",
      shopBase: "https://shop.test/s/palette",
    });
    expect(card.photoUrl).toBe("https://cdn.test/p.jpg");
    expect(card.text).toContain("1700.00 KZT");
    expect(card.buttons.map((b) => b.label)).toEqual(["Открыть", "Купить", "Назад"]);
    expect(card.buttons[1]?.data).toBe("offer:ABCDEFGH");
  });

  it("листание каталога правит то же сообщение", () => {
    const first = catalogCard({
      items: [
        { id: "a", title: "А" },
        { id: "b", title: "Б" },
      ],
      page: 0,
    });
    const next = deliverPlan(
      "telegram",
      catalogCard({
        items: [
          { id: "a", title: "А" },
          { id: "b", title: "Б" },
        ],
        page: 1,
      }),
      "91",
    );
    expect(deliverPlan("telegram", first, null).op).toBe("send");
    expect(next).toMatchObject({ op: "edit", messageId: "91" });
    expect(afterEdit("failed")).toBe("send_new");
    expect(afterEdit("unknown")).toBe("keep");
    expect(first.text).toContain("А");
  });

  it("Instagram и WhatsApp: не больше трёх кнопок и без окна Mini App", () => {
    const card = productCard({
      title: "Палитра",
      totalMinor: 100,
      currency: "KZT",
      offerId: "ABCDEFGH",
      productId: "11111111-1111-4111-8111-111111111111",
      shopBase: "https://shop.test/s/palette",
    });
    for (const channel of ["instagram", "whatsapp"] as const) {
      const sent = deliverPlan(channel, card, "91");
      expect(sent.op).toBe("send");
      if (sent.op === "send") {
        expect(sent.card.buttons.length).toBeLessThanOrEqual(3);
        expect(sent.card.buttons.some((b) => b.webAppUrl)).toBe(false);
        expect(sent.card.buttons.some((b) => b.data.startsWith("offer:"))).toBe(true);
      }
    }
    expect(fitButtons("instagram", card.buttons).length).toBeLessThanOrEqual(3);
  });

  it("задаток не называется оплачено, чужая валюта видна", () => {
    const partial = orderCard({
      no: 4,
      state: "partial",
      paidMinor: 5000,
      dueMinor: 5000,
      currency: "KZT",
      others: [{ currency: "USD", amountMinor: 100 }],
      step: "accepted",
    });
    expect(partial.text).toContain("Задаток");
    expect(partial.text).not.toContain("Оплачено");
    expect(partial.text).toContain("1.00 USD");
    expect(partial.text).toContain("Принят");
    expect(moneyWord("paid", "en")).toBe("Paid");
    const paid = orderCard({
      no: 4,
      state: "paid",
      paidMinor: 10000,
      dueMinor: 0,
      currency: "KZT",
    });
    expect(paid.text).toContain("Оплачено");
  });

  it("голос и реакция заказ не создают, урок — карточка с кнопкой", () => {
    expect(voiceCard("kk").buttons).toEqual([]);
    expect(voiceCard().text).not.toMatch(/offer:/);
    expect(reactionOrder()).toBeNull();
    expect(lessonCard({ title: "Урок 1", lessonId: "L1" }).buttons[0]?.data).toBe("lesson:L1");
  });
});
