import { describe, expect, it } from "vitest";
import {
  RECEIPT_CHECKS_PER_DAY,
  RECEIPT_CHECKS_PER_ORDER,
  receiptCheckBlocked,
  withReceiptCheck,
} from "./attempts";
import type { DialogState } from "@/core/customers/customers";

const NOW = new Date("2026-09-26T12:00:00Z");
const TOMORROW = new Date("2026-09-27T00:01:00Z");

function times(state: DialogState, orderId: number, n: number, now = NOW): DialogState {
  for (let i = 0; i < n; i++) state = withReceiptCheck(state, orderId, now);
  return state;
}

describe("лимит автопроверок чека на покупателя", () => {
  it("новый покупатель может проверить чек", () => {
    expect(receiptCheckBlocked({}, 1, NOW)).toBeNull();
  });

  it(`по одному заказу — не больше ${RECEIPT_CHECKS_PER_ORDER} проверок`, () => {
    const s = times({}, 7, RECEIPT_CHECKS_PER_ORDER - 1);
    expect(receiptCheckBlocked(s, 7, NOW)).toBeNull();
    expect(receiptCheckBlocked(withReceiptCheck(s, 7, NOW), 7, NOW)).toBe("order");
  });

  it("лимит заказа не переходит на другой заказ и держится на следующий день", () => {
    const s = times({}, 7, RECEIPT_CHECKS_PER_ORDER);
    expect(receiptCheckBlocked(s, 8, NOW)).toBeNull();
    expect(receiptCheckBlocked(s, 7, TOMORROW)).toBe("order");
  });

  it(`за сутки — не больше ${RECEIPT_CHECKS_PER_DAY} проверок, даже по разным заказам`, () => {
    let s: DialogState = {};
    for (let i = 0; i < RECEIPT_CHECKS_PER_DAY; i++) s = withReceiptCheck(s, 100 + i, NOW);
    expect(receiptCheckBlocked(s, 999, NOW)).toBe("day");
    expect(receiptCheckBlocked(s, 999, TOMORROW)).toBeNull();
  });

  it("не трогает остальное состояние диалога", () => {
    const s = withReceiptCheck({ mode: "awaiting_proof", locale: "kk" }, 1, NOW);
    expect(s.mode).toBe("awaiting_proof");
    expect(s.locale).toBe("kk");
  });

  it("битое значение в состоянии — как пустой счётчик", () => {
    expect(receiptCheckBlocked({ receipt_checks: "x" }, 1, NOW)).toBeNull();
    expect(receiptCheckBlocked({ receipt_checks: [1, 2] }, 1, NOW)).toBeNull();
    const s = withReceiptCheck({ receipt_checks: { n: "abc", order_id: 1, order_n: -5 } }, 1, NOW);
    expect(s.receipt_checks).toEqual({ day: "2026-09-26", n: 1, order_id: 1, order_n: 1 });
  });
});
