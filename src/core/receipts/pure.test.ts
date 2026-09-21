import { describe, expect, it } from "vitest";
import {
  analyzeReceiptText,
  extractMoneyAmounts,
  findMatchingAmount,
  isPdf,
  looksLikeFailedPayment,
  looksLikeReceipt,
  looksLikeShopScreenNotReceipt,
} from "./pure";

const KASPI =
  "Kaspi Gold\nПеревод выполнен\nСумма операции 1 900 ₸\n06.09.2026 14:12\n+7 705 511 38 28";

describe("суммы из текста чека", () => {
  it("находит сумму с валютой и не берёт телефон и дату", () => {
    const a = extractMoneyAmounts(KASPI);
    expect(a).toContain(1900);
    expect(a).not.toContain(7055113828);
    expect(a).not.toContain(6.09);
  });
  it("допуск ±30% и ближайшая сумма", () => {
    expect(findMatchingAmount([1900, 2000], 2000)).toBe(2000);
    expect(findMatchingAmount([1500], 2000)).toBe(1500);
    expect(findMatchingAmount([1000], 2000)).toBeNull();
    expect(findMatchingAmount([2700], 2000)).toBeNull();
  });
});

describe("классификация текста", () => {
  it("чек, скрин бота и неудачный платёж", () => {
    expect(looksLikeReceipt(KASPI)).toBe(true);
    expect(
      looksLikeShopScreenNotReceipt(
        "Заказ #12 создан.\nСумма к оплате: 1900 ₸\nПришлите чек в этот чат",
      ),
    ).toBe(true);
    expect(looksLikeShopScreenNotReceipt(KASPI)).toBe(false);
    expect(looksLikeFailedPayment("Сбербанк\nПеревод 1900 ₽\nПлатёж не прошёл")).toBe(true);
  });
  it("analyzeReceiptText: ок, не чек, валюта, сумма", () => {
    expect(analyzeReceiptText(KASPI, 2000, "KZT")).toEqual({ ok: true, matchedAmount: 1900 });
    expect(analyzeReceiptText("привет", 2000, "KZT")).toMatchObject({
      ok: false,
      reason: "not_receipt",
    });
    expect(
      analyzeReceiptText("Сбербанк перевод выполнен\nСумма операции 1900 ₽", 1900, "KZT"),
    ).toMatchObject({
      ok: false,
      reason: "currency_mismatch",
    });
    expect(analyzeReceiptText(KASPI, 5000, "KZT")).toMatchObject({
      ok: false,
      reason: "amount_mismatch",
    });
    expect(
      analyzeReceiptText("Kaspi перевод выполнен сумма 1900 ₸ платёж не прошёл", 1900, "KZT"),
    ).toMatchObject({
      reason: "payment_failed",
    });
  });
  it("isPdf по mime и сигнатуре", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("image/jpeg", new TextEncoder().encode("%PDF-1.4"))).toBe(true);
    expect(isPdf("image/jpeg", new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});
