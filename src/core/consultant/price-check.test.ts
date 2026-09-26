import { describe, expect, it } from "vitest";
import { checkReplyFacts, knownNumbers, numbersIn } from "./price-check";

/** Перенос проверок цен из v1 (tests/consultant.test.ts, validateConsultantReply). */
describe("сверка цен в ответе консультанта с каталогом", () => {
  const towel = knownNumbers({ prices: [45000], texts: [] });

  it("режет цену, которой не было в tools", () => {
    expect(checkReplyFacts("Стоит 99999 тенге", towel).ok).toBe(false);
    expect(checkReplyFacts("Цена 45 000 ₸", towel).ok).toBe(true);
    expect(checkReplyFacts("Цена 45000 KZT", towel).ok).toBe(true);
  });

  it("режет выдуманную стоимость доставки", () => {
    expect(checkReplyFacts("Доставка стоит 1500 ₽, СДЭК", towel).ok).toBe(false);
    expect(checkReplyFacts("Доставка по России — СДЭК, за счёт покупателя.", towel).ok).toBe(true);
    // Небольшая сумма доставки тоже выдумка, если её нет в условиях продавца.
    expect(checkReplyFacts("Доставка — 500 ₸", towel).ok).toBe(false);
    const withTerms = knownNumbers({ prices: [45000], texts: ["Доставка по городу 500 тг"] });
    expect(checkReplyFacts("Доставка по городу — 500 ₸", withTerms).ok).toBe(true);
  });

  it("валидатор цен не бракует телефонные номера, года и суммы наборов", () => {
    const facts = knownNumbers({ prices: [8900, 25000], texts: [] });
    expect(
      checkReplyFacts(
        "Спасибо! Свяжемся по номеру +7 701 123 45 67 для подтверждения 8 900 ₸",
        facts,
      ).ok,
    ).toBe(true);
    expect(checkReplyFacts("Коллекция 2026 года по цене 25 000 ₸", facts).ok).toBe(true);
    expect(checkReplyFacts("Итоговая стоимость набора 33 900 ₸", facts).ok).toBe(true);
    expect(checkReplyFacts("Два полотенца — 17 800 ₸", facts).ok).toBe(true);
  });

  it("мелкая цена в валюте тоже сверяется, числа без валюты меньше 1000 — нет", () => {
    const usd = knownNumbers({ prices: [97.5], texts: [] });
    expect(checkReplyFacts("Цена $97.50", usd).ok).toBe(true);
    expect(checkReplyFacts("Цена 120 USD", usd).ok).toBe(false);
    expect(checkReplyFacts("Размер 50х90, осталось 3 штуки", usd).ok).toBe(true);
  });

  it("числа из базы знаний, условий продавца и слов клиента не считаются выдумкой", () => {
    const k = knownNumbers({
      prices: [45000],
      texts: ["Скидка при заказе от 100 000 ₸", "У меня бюджет 60 000"],
    });
    expect(checkReplyFacts("При заказе от 100 000 ₸ действует скидка", k).ok).toBe(true);
    expect(checkReplyFacts("В бюджет 60 000 ₸ укладывается полотенце за 45 000 ₸", k).ok).toBe(
      true,
    );
  });

  it("разбирает числа с пробелами, неразрывным пробелом и запятой", () => {
    expect(numbersIn("45 000 ₸, 45 000, 45,000 и 97,5")).toEqual([45000, 45000, 45000, 97.5]);
  });
});
