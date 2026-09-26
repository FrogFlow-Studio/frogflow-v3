import { describe, expect, it } from "vitest";
import { checkInvoiceReceipt, receiptDates, receiptOperationId } from "./invoice-check";

const kaspi = (sum: string, date = "27.09.2026", to = "Яков В.") =>
  `Kaspi.kz\nПеревод успешно совершен\n${sum}\nПолучатель ${to}\nДата и время ${date} 13:51\nКвитанция № 1234567`;
const invoice = {
  amount: 9900,
  currency: "KZT",
  createdAt: "2026-09-26T10:00:00Z",
  recipient: "Яков В.",
};

describe("автопроверка чека за подписку", () => {
  it("чек Kaspi на точную сумму после выставления счёта — принят", () => {
    expect(checkInvoiceReceipt(kaspi("9 900 ₸"), invoice)).toEqual({
      ok: true,
      operationId: "1234567",
    });
  });

  it("сумма в пределах допуска заказов, но не точная — ручная проверка", () => {
    const r = checkInvoiceReceipt(kaspi("9 000 ₸"), invoice);
    expect(r.ok).toBe(false);
  });

  it("не чек — ручная проверка", () => {
    expect(checkInvoiceReceipt("Счёт на оплату подписки 9 900 ₸", invoice).ok).toBe(false);
  });

  it("чек раньше счёта — ручная проверка", () => {
    const r = checkInvoiceReceipt(kaspi("9 900 ₸", "20.09.2026"), invoice);
    expect(r).toMatchObject({ ok: false, detail: expect.stringContaining("2026-09-20") });
  });

  it("получатель задан — должен быть в чеке", () => {
    expect(checkInvoiceReceipt(kaspi("9 900 ₸"), { ...invoice, recipient: "яков в." }).ok).toBe(
      true,
    );
    expect(
      checkInvoiceReceipt(kaspi("9 900 ₸", "27.09.2026", "Иван П."), {
        ...invoice,
        recipient: "Яков В.",
      }).ok,
    ).toBe(false);
  });

  it("получатель не задан — чек всегда идёт оператору, даже правильный", () => {
    for (const recipient of [undefined, null, "", "  "]) {
      const r = checkInvoiceReceipt(kaspi("9 900 ₸"), { ...invoice, recipient });
      expect(r).toMatchObject({ ok: false, detail: expect.stringContaining("не указан") });
    }
  });

  it("без номера операции — оператору: повтор не поймать", () => {
    const text = kaspi("9 900 ₸").replace("Квитанция № 1234567", "");
    expect(checkInvoiceReceipt(text, invoice)).toMatchObject({
      ok: false,
      operationId: null,
      detail: expect.stringContaining("номер операции"),
    });
  });

  it("номер операции из чека", () => {
    expect(receiptOperationId("Квитанция № 1234567")).toBe("1234567");
    expect(receiptOperationId("№ квитанции: QR 12 345 678")).toBe("QR12345678");
    expect(receiptOperationId("Номер операции 123-456-789")).toBe("123456789");
    expect(receiptOperationId("Чек № 12\n2026 год")).toBeNull();
    expect(receiptOperationId("Квитанция № 1234567\n13:51")).toBe("1234567");
    expect(receiptOperationId("Сумма 9 900 ₸")).toBeNull();
  });

  it("даты из чека", () => {
    expect(receiptDates("27.09.2026 13:51, 2026-09-28, 99.99.2026")).toEqual([
      "2026-09-27",
      "2026-09-28",
    ]);
  });
});
