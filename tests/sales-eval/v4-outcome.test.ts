import { describe, expect, it } from "vitest";
import { checkTurn, isEmptyAnswer } from "./checks";
import { v4TurnOutcome } from "./v4-outcome";

/**
 * Тесты самого мерила на настоящих ходах прогона 05.11
 * (reports/v4-audit/seller-live-eval-2026-11-05.md): ход с кнопкой не может
 * получить «нет кнопки», ход «нажмите Купить» без цены и ответа — пустой.
 */
const button = { productId: "p", title: "Палитра", label: "Купить: Палитра" };
const reply = (text: string, buttons = [button], actions: Array<{ kind: string }> = []) =>
  ({ kind: "reply", text, buttons, actions }) as const;

// Ходы 05.11 дословно: [текст, была ли кнопка, пустой ли по сути].
const RUN_0511: Array<[string, boolean, boolean]> = [
  [
    "Вот кнопка для оформления — выбирайте удобный способ оплаты и покупка оформится 😊",
    true,
    true,
  ],
  ["Вот кнопка для оформления заказа 👇", true, true],
  ["Нажимайте «Купить» — и оформим 😊", true, true],
  [
    "Здравствуйте! Палитра средств выразительности стоит 1 700 ₸. Оплатить можно картой по ссылке (файл придёт сразу) или переводом Kaspi по реквизитам с чеком. Кнопка «Купить» ниже 👇",
    true,
    false,
  ],
  ["Если удобно, можно оформить покупку прямо сейчас — кнопка «Купить» выше 👆", true, true],
  ["Готово — кнопка «Купить» уже под ответом, оформляйте, когда удобно 🙂", true, true],
  [
    "Кнопка «Купить» уже под сообщением — нажимайте и выбирайте удобный способ оплаты 🌸",
    true,
    true,
  ],
  ["Жду вашего заказа — нажмите «Купить» ниже 👇", true, true],
  [
    "По 5 классу есть два сборника: по русскому языку и по русской литературе, каждый по 2 500 ₸. Какой вам нужен — один из них или оба?",
    false,
    false,
  ],
  [
    "Понимаю, коротко: русский язык или литература, и класс (5–11)? Если удобнее — могу сразу предложить полный комплект «все классы».",
    false,
    false,
  ],
  ["Міне, тапсырысты рәсімдеу үшін төмендегі батырманы басыңыз 🙂", true, true],
];

describe("мерило продаж для v4", () => {
  it("ход с кнопкой v4 — это предложение купить, флага «нет кнопки» нет", () => {
    for (const [text, hasButton] of RUN_0511) {
      const flags = checkTurn(v4TurnOutcome(reply(text, hasButton ? [button] : [])), {
        buy: "offer",
      });
      expect(flags.includes("no_offer"), text).toBe(!hasButton);
    }
  });

  it("пустой ответ «нажмите Купить» виден, ответ с ценой и вопрос — нет", () => {
    for (const [text, , empty] of RUN_0511) expect(isEmptyAnswer(text), text).toBe(empty);
    const emptyCount = RUN_0511.filter(([t]) => isEmptyAnswer(t)).length;
    expect(emptyCount).toBe(8);
    expect(isEmptyAnswer("Какой класс?")).toBe(false);
    expect(isEmptyAnswer("Tap “Buy” below 👇")).toBe(true);
    expect(isEmptyAnswer("Sotib olish tugmasini bosing")).toBe(true);
  });

  it("молчание из-за передачи и передача инструментом видны как передача", () => {
    expect(v4TurnOutcome({ kind: "silent", reason: "handoff" }).handedOff).toBe(true);
    expect(v4TurnOutcome(reply("Передала продавцу", [], [{ kind: "handoff" }])).handedOff).toBe(
      true,
    );
    expect(v4TurnOutcome(reply("Вот", [button]), 1)).toMatchObject({ newOrders: 1 });
  });
});
