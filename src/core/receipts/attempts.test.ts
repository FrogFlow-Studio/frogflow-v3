import { describe, expect, it } from "vitest";
import {
  RECEIPT_CHECKS_PER_DAY,
  RECEIPT_CHECKS_PER_ORDER,
  receiptCheckBlocked,
  receiptChecksKey,
  withReceiptCheck,
} from "./attempts";

const NOW = new Date("2026-09-26T12:00:00Z");
const TOMORROW = new Date("2026-09-27T00:01:00Z");

function times(raw: string | null, orderId: number, n: number, now = NOW): string | null {
  for (let i = 0; i < n; i++) raw = withReceiptCheck(raw, orderId, now);
  return raw;
}

describe("лимит автопроверок чека на покупателя", () => {
  it("новый покупатель может проверить чек", () => {
    expect(receiptCheckBlocked(null, 1, NOW)).toBeNull();
  });

  it(`по одному заказу — не больше ${RECEIPT_CHECKS_PER_ORDER} проверок`, () => {
    const s = times(null, 7, RECEIPT_CHECKS_PER_ORDER - 1);
    expect(receiptCheckBlocked(s, 7, NOW)).toBeNull();
    expect(receiptCheckBlocked(withReceiptCheck(s, 7, NOW), 7, NOW)).toBe("order");
  });

  it("лимит заказа не переходит на другой заказ и держится на следующий день", () => {
    const s = times(null, 7, RECEIPT_CHECKS_PER_ORDER);
    expect(receiptCheckBlocked(s, 8, NOW)).toBeNull();
    expect(receiptCheckBlocked(s, 7, TOMORROW)).toBe("order");
  });

  it(`за сутки — не больше ${RECEIPT_CHECKS_PER_DAY} проверок, даже по разным заказам`, () => {
    let s: string | null = null;
    for (let i = 0; i < RECEIPT_CHECKS_PER_DAY; i++) s = withReceiptCheck(s, 100 + i, NOW);
    expect(receiptCheckBlocked(s, 999, NOW)).toBe("day");
    expect(receiptCheckBlocked(s, 999, TOMORROW)).toBeNull();
  });

  it("ключ счётчика — свой у каждого покупателя", () => {
    expect(receiptChecksKey("tg_1")).not.toBe(receiptChecksKey("tg_2"));
  });

  it("битое значение — как пустой счётчик", () => {
    expect(receiptCheckBlocked("x", 1, NOW)).toBeNull();
    expect(receiptCheckBlocked("[1,2]", 1, NOW)).toBeNull();
    const s = withReceiptCheck(JSON.stringify({ n: "abc", order_id: 1, order_n: -5 }), 1, NOW);
    expect(JSON.parse(s)).toEqual({ day: "2026-09-26", n: 1, order_id: 1, order_n: 1 });
  });
});
