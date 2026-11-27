import { describe, expect, it } from "vitest";
import { isSimpleMessage, routeTurn } from "./route";

describe("какая модель отвечает", () => {
  it.each([
    "Здравствуйте!",
    "спасибо большое 🙏",
    "Добрый день",
    "где мой заказ?",
    "Рахмет!",
    "сәлеметсіз бе",
    "thanks",
    "Assalomu alaykum",
    "ок, спасибо",
  ])("простое: %s → быстрая", (t) => {
    expect(isSimpleMessage(t)).toBe(true);
    expect(routeTurn({ text: t, photo: false, lastReplyHadButtons: false })).toBe("fast");
  });

  it.each([
    "Сколько стоит палитра?",
    "спасибо, а для 3 класса есть?",
    "привет, дорого",
    "хочу купить",
    "Здравствуйте, 2 штуки",
    "",
    "папка",
    "қанша тұрады?",
  ])("всё остальное: %s → сильная", (t) => {
    expect(routeTurn({ text: t, photo: false, lastReplyHadButtons: false })).toBe("strong");
  });

  it("фото или кнопка на прошлом ответе — сильная даже на «ок»", () => {
    expect(routeTurn({ text: "ок", photo: true, lastReplyHadButtons: false })).toBe("strong");
    expect(routeTurn({ text: "ок", photo: false, lastReplyHadButtons: true })).toBe("strong");
  });
});
