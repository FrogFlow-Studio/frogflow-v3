import { describe, expect, it } from "vitest";
import { REASON_MAX } from "@/core/chat/reason";
import { explainIncoming } from "./reason";

const why = (text: string, extra: Partial<Parameters<typeof explainIncoming>[0]> = {}) =>
  explainIncoming({ mode: "idle", text, ...extra });

describe("Direct: почему бот так ответил — по одному случаю на каждый тип входящего", () => {
  it("команда: каталог, корзина", () => {
    expect(why("каталог")).toBe("step=idle cmd=catalog");
    expect(why("корзина", { mode: "cart" })).toBe("step=cart cmd=cart");
  });

  it("слово-вызов продавца открывает каталог", () => {
    expect(why("Хочу прописи", { trigger: true })).toBe("step=idle cmd=catalog trigger=1");
  });

  it("слово отмены", () => {
    expect(why("отмена", { mode: "awaiting_address" })).toBe("step=awaiting_address cancel=1");
  });

  it("номер телефона — не коды товаров (skipped=phone)", () => {
    expect(why("87770637152")).toBe("step=idle skipped=phone");
    expect(why("+7 777 063 71 52", { mode: "cart" })).toBe("step=cart skipped=phone");
  });

  it("один код, несколько кодов", () => {
    expect(why("018")).toBe("step=idle parsed=code");
    expect(why("12 14 15")).toBe("step=idle parsed=codes");
  });

  it("«да», «спасибо», вопрос", () => {
    expect(why("да")).toBe("step=idle parsed=yes");
    expect(why("спасибо")).toBe("step=idle parsed=thanks");
    expect(why("а есть ли доставка в Астану?")).toBe("step=idle parsed=question");
  });

  it("устаревший шаг помечается", () => {
    expect(why("каталог", { mode: "cart", stale: true })).toBe("step=cart stale=1 cmd=catalog");
  });

  it("кнопка, вложение без текста, пусто", () => {
    expect(why("", { postback: "CATALOG" })).toBe("step=idle button=catalog");
    expect(why("", { attachments: 1, mode: "awaiting_proof" })).toBe(
      "step=awaiting_proof parsed=attachment",
    );
    expect(why("  ")).toBe("step=idle parsed=empty");
  });

  it("причина короткая и не содержит текста покупателя", () => {
    const secret = "Меня зовут Айгерим живу на Абая 15 квартира 7";
    for (const text of [secret, "87770637152", "каталог", "12 14", "да"]) {
      const r = why(text)!;
      expect(r.length).toBeLessThan(200);
      expect(r.length).toBeLessThanOrEqual(REASON_MAX);
      expect(r).not.toMatch(/Айгерим|Абая|квартира/i);
    }
  });
});
