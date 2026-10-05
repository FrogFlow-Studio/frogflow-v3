import { describe, expect, it } from "vitest";
import type { OrderEvent, OrderEventKind } from "./events";
import { orderMoney } from "./money";

let n = 0;
const ev = (kind: OrderEventKind, payload: Record<string, unknown>, at?: string): OrderEvent => ({
  id: `e${++n}`,
  at: at ?? `2026-10-0${1 + (n % 9)}T10:00:00Z`,
  kind,
  actor: "system",
  payload: payload as OrderEvent["payload"],
});
const base = {
  status: "paid",
  total: 12000,
  paid_amount: 0,
  fulfillment_kind: "digital",
  currency: "KZT",
  discount_amount: 0,
};
const money = (over: Partial<typeof base> = {}, events: OrderEvent[] = [], extra = {}) =>
  orderMoney({
    order: { ...base, ...over },
    events,
    dueNow: 12000,
    refunded: 0,
    refundable: 0,
    ...extra,
  });

describe("блок «Деньги»: суммы из журнала", () => {
  it("каждая сумма события видна строкой с шлюзом и номером платежа", () => {
    const m = money({}, [
      ev("payment", {
        amount: 12000,
        currency: "KZT",
        source: "online",
        provider: "Stripe",
        invId: "pi_1",
      }),
    ]);
    expect(m.total).toBe(12000);
    expect(m.received).toBe(12000);
    expect(m.method).toBe("Stripe");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({
      kind: "payment",
      amount: 12000,
      method: "Stripe",
      ref: "pi_1",
      flag: null,
    });
  });

  it("задаток и чек — способ «receipt», переплата по чеку выделена и сложена", () => {
    const m = money({ status: "accepted", fulfillment_kind: "physical", paid_amount: 5000 }, [
      ev("payment", { amount: 3000, source: "deposit" }, "2026-10-01T10:00:00Z"),
      ev("payment", { amount: 2000, source: "receipt", overpaid: 500 }, "2026-10-02T10:00:00Z"),
    ]);
    expect(m.method).toBe("receipt");
    expect(m.rows.map((r) => r.amount)).toEqual([3000, 2000]);
    expect(m.rows[1]).toMatchObject({ overpaid: 500, flag: "overpaid" });
    expect(m.overpaid).toBe(500);
    expect(m.flags).toEqual(["overpaid"]);
    expect(m.received).toBe(5000);
    expect(m.remaining).toBe(7000);
  });

  it("оплата по отменённому заказу, переплата остатка и расхождение платежа выделены", () => {
    const m = money({ status: "cancelled" }, [
      ev("payment_on_closed", {
        amount: 12000,
        currency: "KZT",
        provider: "Stripe",
        invId: "pi_9",
      }),
      ev("balance_overpaid", { amount: 700, provider: "Robokassa", invId: "81" }),
      ev("payment_mismatch", { amount: 5, currency: "USD", provider: "NOWPayments", invId: "555" }),
    ]);
    expect(m.rows.map((r) => [r.kind, r.amount, r.ref, r.flag])).toEqual(
      expect.arrayContaining([
        ["on_closed", 12000, "pi_9", "closed"],
        ["balance_overpaid", 700, "81", "overpaid"],
        ["mismatch", 5, "555", "mismatch"],
      ]),
    );
    expect(m.rows).toHaveLength(3);
    expect([...m.flags].sort()).toEqual(["closed", "mismatch", "overpaid"]);
    // Закрытый заказ ничего не «ждёт».
    expect(m.remaining).toBe(0);
  });

  it("возвраты: суммы из журнала, причина и платёж, к которому относятся", () => {
    const m = money(
      {},
      [
        ev(
          "payment",
          { amount: 12000, source: "online", provider: "Stripe", invId: "pi_1" },
          "2026-10-01T10:00:00Z",
        ),
        ev("refund", { amount: 2000, reason: "брак" }, "2026-10-02T10:00:00Z"),
        ev("refund", { amount: 1000, paymentRef: "pi_1" }, "2026-10-03T10:00:00Z"),
      ],
      { refunded: 3000, refundable: 9000 },
    );
    const refunds = m.rows.filter((r) => r.kind === "refund");
    expect(refunds.map((r) => [r.amount, r.reason, r.paymentRef])).toEqual([
      [2000, "брак", "pi_1"],
      [1000, null, "pi_1"],
    ]);
    expect(m.refunded).toBe(3000);
    expect(m.refundable).toBe(9000);
    expect(m.method).toBe("Stripe");
  });

  it("возврат при нескольких платежах без названного платежа — без ссылки, чтобы не гадать", () => {
    const m = money({}, [
      ev(
        "payment",
        { amount: 6000, source: "online", provider: "Stripe", invId: "a" },
        "2026-10-01T10:00:00Z",
      ),
      ev(
        "balance_paid",
        { amount: 6000, provider: "Robokassa", invId: "9" },
        "2026-10-02T10:00:00Z",
      ),
      ev(
        "payment",
        { amount: 100, source: "online", provider: "Stripe", invId: "b" },
        "2026-10-02T11:00:00Z",
      ),
      ev("refund", { amount: 500 }, "2026-10-03T10:00:00Z"),
    ]);
    expect(m.rows.find((r) => r.kind === "refund")!.paymentRef).toBeNull();
  });

  it("чек на остаток: сумма сверяется с тем, что заказ ждёт; решение продавца снимает ожидание", () => {
    const wrong = money(
      { status: "accepted", fulfillment_kind: "physical", paid_amount: 3000 },
      [ev("balance_proof", { amount: 8000 }, "2026-10-02T10:00:00Z")],
      { dueNow: 9000 },
    );
    expect(wrong.proof).toEqual({ pending: true, amount: 8000, expected: 9000, matches: false });
    const right = money(
      { status: "accepted", fulfillment_kind: "physical", paid_amount: 3000 },
      [ev("balance_proof", { amount: 9000 }, "2026-10-02T10:00:00Z")],
      { dueNow: 9000 },
    );
    expect(right.proof.matches).toBe(true);
    const done = money({ status: "accepted", fulfillment_kind: "physical" }, [
      ev("balance_proof", { amount: 9000 }, "2026-10-02T10:00:00Z"),
      ev("balance_proof_rejected", {}, "2026-10-03T10:00:00Z"),
    ]);
    expect(done.proof).toMatchObject({ pending: false, amount: null, matches: null });
  });

  it("журнал без денег — строк нет; скидка и итог из заказа; события других видов не попадают", () => {
    const m = money({ discount_amount: 1500 }, [ev("placed", {}), ev("delivered", {})]);
    expect(m.rows).toEqual([]);
    expect(m.discount).toBe(1500);
    expect(m.method).toBeNull();
    expect(m.flags).toEqual([]);
  });
});

describe("способ оплаты — ключи, не русские слова", () => {
  it("«чек» и «вручную» отдаются ключами, шлюз как есть", () => {
    const m = orderMoney({
      order: { status: "accepted", fulfillment_kind: "physical", paid_amount: 100 } as never,
      events: [
        {
          id: "e1",
          at: "2026-10-01T10:00:00Z",
          kind: "payment",
          payload: { amount: 100 },
        } as never,
      ],
      dueNow: 0,
      refunded: 0,
      refundable: 0,
    });
    expect(m.rows[0]!.method).toBe("manual");
  });
});
