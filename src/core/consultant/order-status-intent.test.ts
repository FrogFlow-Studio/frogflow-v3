import { describe, expect, it } from "vitest";
import { isOrderStatusQuestion } from "./order-status-intent";

describe("isOrderStatusQuestion", () => {
  it.each([
    ["Вы отменили заказ?", true],
    ["Какой статус моего заказа?", true],
    ["Где мой заказ?", true],
    ["Менің тапсырысым қайда?", true],
    ["Buyurtmam bekor qilindimi?", true],
    ["Where is my order?", true],
    ["Has my order been cancelled?", true],
    ["Отмените пожалуйста", false],
    ["Отмените заказ, пожалуйста", false],
    ["Оформите заказ", false],
  ] as const)("%s => %s", (text, expected) => {
    expect(isOrderStatusQuestion(text)).toBe(expected);
  });
});
