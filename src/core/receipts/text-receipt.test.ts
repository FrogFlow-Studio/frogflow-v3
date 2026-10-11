import { describe, expect, it } from "vitest";
import { looksLikeTextReceipt, receiptOperationNo, receiptTextOn } from "./text-receipt";

describe("чек текстом", () => {
  it("текст Kaspi из приложения — чек, номер операции — для отпечатка", () => {
    const t =
      "Оплата совершена\n800 ₸\nПолучатель: ИП Анастасия\n№ чека QR18040511543\n11.10.2026 11:49";
    expect(looksLikeTextReceipt(t)).toBe(true);
    expect(receiptOperationNo(t)).toBe("QR18040511543");
  });

  it("сумма с валютой и слова чека без номера — чек", () => {
    expect(looksLikeTextReceipt("Перевод выполнен успешно, 1 500 тг")).toBe(true);
    expect(looksLikeTextReceipt("Платёж проведён 132 руб")).toBe(true);
  });

  it("рассказ «я оплатила», вопрос, телефон — не чек", () => {
    expect(looksLikeTextReceipt("Я оплатила 800 тг")).toBe(false);
    expect(looksLikeTextReceipt("Скрин невозможно сделать. Почему?")).toBe(false);
    expect(looksLikeTextReceipt("мой номер 87770637152")).toBe(false);
    expect(looksLikeTextReceipt("Заказ № 1415 оплатила")).toBe(false);
  });

  it("включено по умолчанию, выключает только «false»", () => {
    expect(receiptTextOn(null)).toBe(true);
    expect(receiptTextOn("true")).toBe(true);
    expect(receiptTextOn("false")).toBe(false);
  });
});
