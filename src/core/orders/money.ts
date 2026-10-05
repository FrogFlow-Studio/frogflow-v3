import type { Json } from "@/core/db-types";
import type { OrderEvent } from "./events";
import { receivedAmount } from "./refund";

/**
 * Блок «Деньги» карточки заказа (З3): всё, что известно о деньгах заказа, из
 * самого заказа и его журнала — сумма, способ, чек со сверкой, переплата,
 * возвраты. Журнал не меняется: сюда только читается, каждая сумма события
 * видна строкой, а переплата и оплата по закрытому заказу выделены флагом.
 */
export type MoneyRowKind =
  | "payment"
  | "balance"
  | "refund"
  | "mismatch"
  | "on_closed"
  | "balance_closed"
  | "balance_overpaid";

export type MoneyFlag = "overpaid" | "closed" | "mismatch";

export type MoneyRow = {
  id: string;
  at: string;
  kind: MoneyRowKind;
  /** Сумма события в валюте заказа (для платежей — как записано в журнале). */
  amount: number;
  currency: string | null;
  /** Шлюз, «чек» или «вручную». */
  method: string | null;
  /** Номер платежа или счёта у шлюза. */
  ref: string | null;
  /** Переплата по чеку из этого платежа, если есть. */
  overpaid: number;
  flag: MoneyFlag | null;
  /** Для возврата: номер платежа, к которому он относится (если он один или назван в событии). */
  paymentRef: string | null;
  reason: string | null;
};

export type MoneyProof = {
  /** Чек на остаток ждёт проверки продавцом. */
  pending: boolean;
  /** Сумма в чеке на остаток. */
  amount: number | null;
  /** Сколько заказ ждёт сейчас. */
  expected: number;
  /** Сумма чека совпала с ожидаемой; null — чека на проверке нет. */
  matches: boolean | null;
};

export type OrderMoney = {
  total: number;
  currency: string;
  discount: number;
  /** Получено по заказу (для физического — внесённое, у выданного не меньше итога). */
  received: number;
  /** Сколько ещё не получено (только физический, пока заказ не закрыт). */
  remaining: number;
  /** Способ последней оплаты. */
  method: string | null;
  refunded: number;
  refundable: number;
  /** Сумма переплат по чекам и платежей сверх остатка. */
  overpaid: number;
  proof: MoneyProof;
  rows: MoneyRow[];
  flags: MoneyFlag[];
};

const num = (v: Json | undefined) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: Json | undefined) => (typeof v === "string" && v ? v : null);
const cents = (n: number) => Math.round(n * 100) / 100;

const SOURCE_METHOD: Record<string, string> = {
  deposit: "receipt",
  receipt: "receipt",
};

function methodOf(p: OrderEvent["payload"]): string | null {
  if (p.source === "online") return str(p.provider);
  if (typeof p.source === "string" && SOURCE_METHOD[p.source]) return SOURCE_METHOD[p.source]!;
  return str(p.provider) ?? "manual";
}

const MONEY_KINDS: Record<string, MoneyRowKind> = {
  payment: "payment",
  balance_credited: "balance",
  balance_paid: "balance",
  refund: "refund",
  payment_mismatch: "mismatch",
  payment_on_closed: "on_closed",
  balance_closed: "balance_closed",
  balance_overpaid: "balance_overpaid",
};

const FLAG_OF: Partial<Record<MoneyRowKind, MoneyFlag>> = {
  mismatch: "mismatch",
  on_closed: "closed",
  balance_closed: "closed",
  balance_overpaid: "overpaid",
};

export function orderMoney(input: {
  order: {
    status: string;
    total: number | string | null;
    paid_amount?: number | string | null;
    fulfillment_kind?: string | null;
    currency: string;
    discount_amount?: number | string | null;
  };
  events: OrderEvent[];
  dueNow: number;
  refunded: number;
  refundable: number;
}): OrderMoney {
  const { order: o } = input;
  const events = [...input.events].sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at),
  );
  const rows: MoneyRow[] = [];
  for (const e of events) {
    const kind = MONEY_KINDS[e.kind];
    if (!kind) continue;
    const p = e.payload;
    const overpaid = e.kind === "payment" ? cents(num(p.overpaid)) : 0;
    rows.push({
      id: e.id,
      at: e.at,
      kind,
      amount: cents(num(p.amount)),
      currency: str(p.currency) ?? o.currency,
      method: kind === "refund" ? null : methodOf(p),
      ref: str(p.invId) ?? str(p.ref),
      overpaid,
      flag: overpaid > 0 ? "overpaid" : (FLAG_OF[kind] ?? null),
      paymentRef: null,
      reason: kind === "refund" ? str(p.reason) : null,
    });
  }
  // Возврат относится к платежу, если в событии назван платёж или платёж один.
  const paymentRefs = [
    ...new Set(rows.filter((r) => r.kind === "payment" && r.ref).map((r) => r.ref!)),
  ];
  for (const r of rows) {
    if (r.kind !== "refund") continue;
    const ev = events.find((e) => e.id === r.id);
    r.paymentRef = str(ev?.payload.paymentRef) ?? str(ev?.payload.invId) ?? str(ev?.payload.ref);
    if (!r.paymentRef && paymentRefs.length === 1) r.paymentRef = paymentRefs[0]!;
  }

  // Чек на остаток: последний чек без последующего решения.
  let proofAt = -1;
  let proofAmount: number | null = null;
  events.forEach((e, i) => {
    if (e.kind === "balance_proof") {
      proofAt = i;
      proofAmount = cents(num(e.payload.amount));
    } else if (
      i > proofAt &&
      ["balance_proof_rejected", "balance_credited", "balance_paid"].includes(e.kind)
    )
      proofAt = -1;
  });
  const pending = proofAt >= 0;
  const expected = cents(input.dueNow);

  const total = cents(Number(o.total) || 0);
  const received = cents(receivedAmount(o));
  const closed = ["rejected", "cancelled", "refunded"].includes(o.status);
  const lastPayment = [...rows].reverse().find((r) => r.kind === "payment" || r.kind === "balance");
  const overpaid = cents(rows.reduce((s, r) => s + r.overpaid, 0));
  const flags = [...new Set(rows.map((r) => r.flag).filter((f): f is MoneyFlag => f !== null))];
  return {
    total,
    currency: o.currency,
    discount: cents(Number(o.discount_amount) || 0),
    received,
    remaining:
      o.fulfillment_kind === "physical" && !closed ? cents(Math.max(0, total - received)) : 0,
    method: lastPayment?.method ?? null,
    refunded: cents(input.refunded),
    refundable: cents(input.refundable),
    overpaid,
    proof: {
      pending,
      amount: pending ? proofAmount : null,
      expected,
      matches: pending && proofAmount !== null ? cents(proofAmount) === expected : null,
    },
    rows,
    flags,
  };
}
