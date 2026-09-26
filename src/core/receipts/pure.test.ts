import { describe, expect, it } from "vitest";
import {
  amountsForCurrency,
  analyzeReceiptText,
  detectReceiptCurrencies,
  extractMoneyAmounts,
  findMatchingAmount,
  isPdf,
  isRetryReason,
  looksLikeFailedPayment,
  looksLikeReceipt,
  looksLikeShopScreenNotReceipt,
  OVERPAY_TOLERANCE,
  UNDERPAY_TOLERANCE,
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
    // Мусор перед меткой — как у файла чека (orders/proof-file): тоже PDF.
    expect(isPdf("application/octet-stream", new TextEncoder().encode("\n\n%PDF-1.7"))).toBe(true);
  });
});

describe("допуск суммы (перенос проверок v1)", () => {
  it("константы допуска — ±30%, как в документации", () => {
    expect(UNDERPAY_TOLERANCE).toBe(0.3);
    expect(OVERPAY_TOLERANCE).toBe(0.3);
  });
  it("переплата ровно на 30% проходит, больше — нет", () => {
    expect(findMatchingAmount([1300], 1000)).toBe(1300);
    expect(findMatchingAmount([1310], 1000)).toBeNull();
    expect(findMatchingAmount([700], 1000)).toBe(700);
    expect(findMatchingAmount([690], 1000)).toBeNull();
  });
});

describe("валюта чека", () => {
  it("своя валюта в чеке рядом с чужой — не конфликт, сверяем по своей", () => {
    const text = "Оплата 5000 тенге, комиссия 10 руб";
    expect(detectReceiptCurrencies(text)).toEqual(expect.arrayContaining(["KZT", "RUB"]));
    expect(analyzeReceiptText(text, 5000, "KZT")).toEqual({ ok: true, matchedAmount: 5000 });
  });
  it("только чужая валюта — видим только её", () => {
    expect(detectReceiptCurrencies("Перевод 1000 RUB успешно")).toEqual(["RUB"]);
  });
  it("нет маркеров валюты — пустой список", () => {
    expect(detectReceiptCurrencies("Оплата 5000 получена")).toEqual([]);
  });
  it("чек без упоминания валюты — не конфликт, доверяем сумме", () => {
    expect(analyzeReceiptText("Оплата 5000 получена успешно", 5000, "KZT")).toEqual({
      ok: true,
      matchedAmount: 5000,
    });
  });
  it("валюта вне списка известных — не блокируем", () => {
    expect(analyzeReceiptText("Payment 5000 EUR", 5000, "EUR")).toEqual({
      ok: true,
      matchedAmount: 5000,
    });
  });
  it("без валюты заказа валюту не сверяем", () => {
    expect(analyzeReceiptText("Перевод 5000 RUB", 5000)).toEqual({
      ok: true,
      matchedAmount: 5000,
    });
    expect(analyzeReceiptText("Перевод 5000 RUB", 1000)).toMatchObject({
      ok: false,
      reason: "amount_mismatch",
    });
  });
  it("на смешанном чеке KZT/RUB для тенге остаётся выплата, для рублей — рубли", () => {
    const text = "Сумма выплаты 1101.24 KZT. Сумма операции 228 ₽.";
    expect(amountsForCurrency(text, "KZT")).toEqual(expect.arrayContaining([1101.24]));
    expect(amountsForCurrency(text, "KZT")).not.toContain(228);
    expect(amountsForCurrency(text, "RUB")).toContain(228);
    expect(amountsForCurrency(text, "RUB")).not.toContain(1101.24);
  });
  it("чек с тенге и рублями — находит 1101.24 KZT под заказ 1100 ₸", () => {
    expect(
      analyzeReceiptText(
        "Сумма выплаты 1101.24 KZT. Сумма операции 228 ₽. Телефон 7055113828.",
        1100,
        "KZT",
      ),
    ).toEqual({ ok: true, matchedAmount: 1101.24 });
  });
});

describe("суммы из банковских чеков", () => {
  it("ВТБ: сумма операции 228 ₽ и выплата 1101.24 KZT, не телефон и не дата", () => {
    const text = `
      Перевод по номеру телефона в другую страну
      Дата операции 08.09.2026, 19:33
      Номер телефона 7055113828
      Сумма выплаты 1101.24 KZT
      Курс обмена 1 ₽ = 4.83 KZT
      Комиссия за перевод 0 ₽
      Сумма операции 228 ₽
    `;
    const a = extractMoneyAmounts(text);
    expect(a).toContain(1101.24);
    expect(a).toContain(228);
    expect(a).not.toContain(7055113);
    expect(a).not.toContain(7055113828);
    expect(a).not.toContain(8.09);
    expect(a).not.toContain(2026);
  });
  it("Сбер: «сумма в местной валюте» 1077.30, 661.50 и 1072.58 KZT", () => {
    expect(
      extractMoneyAmounts("Сумма в местной валюте 1077.30 KZT Идентификатор 258797242136PSVG"),
    ).toContain(1077.3);
    expect(extractMoneyAmounts("Сумма в местной валюте 661.50 KZT")).toContain(661.5);
    expect(extractMoneyAmounts("Сумма в местной валюте 1072.58 KZT")).toContain(1072.58);
  });
  it("голое 1900 — тоже сумма, не год", () => {
    expect(extractMoneyAmounts("Оплата 1900 успешно")).toContain(1900);
  });
  it("экран «Платёж выполнен» 227 ₽ с телефоном рядом", () => {
    const a = extractMoneyAmounts("Платёж выполнен\n227 ₽\n7055113828");
    expect(a).toContain(227);
    expect(a).not.toContain(7055113);
    expect(a).not.toContain(7055113828);
  });
});

describe("не чек и неудачный платёж", () => {
  it("успешный чек с оговоркой «в случае ошибки» — не отказ", () => {
    expect(
      looksLikeFailedPayment(
        "Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в поддержку.",
      ),
    ).toBe(false);
    expect(
      looksLikeFailedPayment("Платёж выполнен. Если вы не совершали операцию, обратитесь в банк."),
    ).toBe(false);
    expect(
      analyzeReceiptText(
        "Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в банк.",
        1000,
        "KZT",
      ),
    ).toEqual({ ok: true, matchedAmount: 1000 });
  });
  it("не чек и payment_failed просим переслать, остальное — продавцу", () => {
    expect(isRetryReason("payment_failed")).toBe(true);
    expect(isRetryReason("not_receipt")).toBe(true);
    expect(isRetryReason("amount_mismatch")).toBe(false);
    expect(isRetryReason("currency_mismatch")).toBe(false);
    expect(isRetryReason("receipt_reused")).toBe(false);
    expect(isRetryReason("ocr_unavailable")).toBe(false);
  });
  it("длинный текст без маркеров платежа — не чек", () => {
    expect(looksLikeReceipt("Съешь ещё этих мягких французских булок")).toBe(false);
  });
  it("карточка товара с «в корзине» — не чек, даже если сумма та же", () => {
    const card = "039. Математический тренажёр. 2000 ₸. Продолжить оплату. 0 в корзине.";
    expect(looksLikeShopScreenNotReceipt(card)).toBe(true);
    expect(analyzeReceiptText(card, 2000, "KZT")).toMatchObject({
      ok: false,
      reason: "not_receipt",
    });
    expect(analyzeReceiptText(card, 800, "KZT")).toMatchObject({
      ok: false,
      reason: "not_receipt",
    });
  });
  it("настоящий чек не режется, даже если сверху попал текст бота", () => {
    const mixed = `
      Заказ #911 создан
      Сумма к оплате: 565 ₸
      После оплаты пришлите скриншот в этот чат
      Фискальный чек. Оплата совершена. 565 ₸. Kaspi Gold.
    `;
    expect(looksLikeShopScreenNotReceipt(mixed)).toBe(false);
    expect(looksLikeReceipt(mixed)).toBe(true);
  });
});
