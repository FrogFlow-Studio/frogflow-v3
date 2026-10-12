import { describe, expect, it } from "vitest";
import { parseReceiptReading, readingText, receiptCostUsd, receiptImageType } from "./reader";
import { receiptOperationId } from "@/core/billing/invoice-check";

describe("разбор ответа модели о чеке", () => {
  it("поля по схеме; валюта — только код ISO; признаков не больше пяти", () => {
    const r = parseReceiptReading({
      is_receipt: true,
      status: "success",
      amount: 7,
      currency: "byn",
      operation_id: " 123 ",
      edit_signs: ["a", "b", "c", "d", "e", "f", 5, ""],
      text: " Перевод \n7,00 BYN ",
    });
    expect(r).toMatchObject({
      isReceipt: true,
      status: "success",
      amount: 7,
      currency: "BYN",
      operationId: "123",
      text: "Перевод \n7,00 BYN",
    });
    expect(r!.editSigns).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      parseReceiptReading({ is_receipt: true, status: "x", text: "", currency: "₸" }),
    ).toMatchObject({ status: "unknown", currency: null, amount: null });
  });
  it("нет ответа или не по схеме — null", () => {
    expect(parseReceiptReading(null)).toBeNull();
    expect(parseReceiptReading({ status: "success", text: "чек" })).toBeNull();
    expect(parseReceiptReading({ is_receipt: true })).toBeNull();
  });
  it("номер операции из разбора дописывается, если правила его в тексте не видят", () => {
    const base = parseReceiptReading({
      is_receipt: true,
      status: "success",
      operation_id: "QR 98765 4321",
      edit_signs: [],
      text: "Kaspi\nПеревод 1 000 ₸",
    })!;
    expect(receiptOperationId(readingText(base))).toBe("QR987654321");
    // Короткий «номер» не дописываем: по нему повтор ловить нельзя.
    expect(readingText({ ...base, operationId: "12" })).toBe("Kaspi\nПеревод 1 000 ₸");
  });
  it("цена по usage: Haiku 5.5, $0,10 / $0,50 за миллион", () => {
    expect(receiptCostUsd({ input_tokens: 4800, output_tokens: 800 })).toBe(0.00088);
    expect(receiptCostUsd(undefined)).toBe(0);
  });
  it("тип картинки: по байтам; HEIC и неизвестное по байтам — null; без сигнатуры — заявленный", () => {
    expect(receiptImageType("image/png", "image/jpeg")).toBe("image/png");
    expect(receiptImageType("image/heic", "image/jpeg")).toBeNull();
    expect(receiptImageType(null, "image/webp")).toBe("image/webp");
    expect(receiptImageType(null, "application/octet-stream")).toBe("image/jpeg");
  });
});
