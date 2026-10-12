import { vi } from "vitest";
import { setReceiptModelForTests, type ReceiptFile } from "@/core/receipts/reader.server";

/** Ответ модели, читающей чек: текст чека и, если нужно, поля разбора. */
export function receiptAnswer(text: string, extra: Record<string, unknown> = {}) {
  return {
    is_receipt: true,
    status: "unknown",
    amount: null,
    currency: null,
    datetime: null,
    operation_id: null,
    recipient: null,
    bank: null,
    edit_signs: [],
    text,
    ...extra,
  };
}

/** Подставить модель чеков: каждый вызов «читает» этот текст. Сброс — resetReceiptModel(). */
export function mockReceiptModel(text: string, extra: Record<string, unknown> = {}) {
  const fn = vi.fn(async (file: ReceiptFile) => {
    void file;
    return {
      input: receiptAnswer(text, extra),
      usage: { input_tokens: 1600, output_tokens: 200 },
    };
  });
  setReceiptModelForTests(fn);
  return fn;
}

export function resetReceiptModel() {
  setReceiptModelForTests(null);
}
