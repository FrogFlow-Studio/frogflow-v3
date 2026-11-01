import { serverFailure } from "@/lib/server-failure";
import { attempt, type V4Db, type V4Result } from "../db";

/**
 * Заказы и книга денег v4 (этап 1). Вся логика — в SQL-функциях схемы v4,
 * здесь типы и вызовы. Списки статусов совпадают с check в базе — это
 * проверяет money.test.ts (решение 70: строгие статусы из одного списка).
 */

export const ORDER_STATUSES = ["open", "fulfilled", "expired", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const LEDGER_KINDS = [
  "payment",
  "legacy_unconfirmed",
  "refund",
  "chargeback",
  "platform_fee",
  "correction",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const PAYMENT_METHOD_KINDS = ["transfer", "prodamus", "apipay", "robokassa"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

export const LEDGER_METHODS = [...PAYMENT_METHOD_KINDS, "manual", "legacy"] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];

export const RECEIPT_STATUSES = ["waiting", "accepted", "rejected"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const MONEY_STATES = ["unpaid", "partial", "paid", "overpaid"] as const;
export type MoneyState = (typeof MONEY_STATES)[number];

export type Order = {
  id: string;
  no: number;
  buyerId: string;
  country: string | null;
  currency: string;
  subtotalMinor: number;
  pointsUsed: number;
  pointsDiscountMinor: number;
  totalMinor: number;
  status: OrderStatus;
  isTest: boolean;
  expiresAt: Date;
};

export type PaymentOutcome = {
  entryId: number;
  /** Тот же платёж уже был записан (повтор вебхука, двойной клик). */
  duplicate: boolean;
  /** Ровно этот платёж закрыл сумму заказа — выдавать материалы. */
  becamePaid: boolean;
  /** Деньги пришли по истёкшему или отменённому заказу. */
  orderClosed: boolean;
  /** Валюта платежа не совпала с валютой заказа: в «оплачено» не засчитано. */
  currencyMismatch: boolean;
  paidMinor: number;
  dueMinor: number;
};

export type OrderMoney = {
  orderId: string;
  no: number;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  state: MoneyState;
  /** Есть суммы из v3 без подтверждения (решение 50). */
  unconfirmed: boolean;
  otherCurrency: boolean;
  isTest: boolean;
};

export type PaymentMethod = {
  id: string;
  kind: PaymentMethodKind;
  country: string | null;
  currency: string;
  details: string;
  feeBp: number;
};

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const one = (rows: Row[], fn: string): Row => {
  const r = rows[0];
  if (!r) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r;
};

function toOrder(r: Row): Order {
  return {
    id: String(r.id),
    no: num(r.no),
    buyerId: String(r.buyer_id),
    country: (r.country as string | null) ?? null,
    currency: String(r.currency),
    subtotalMinor: num(r.subtotal_minor),
    pointsUsed: num(r.points_used),
    pointsDiscountMinor: num(r.points_discount_minor),
    totalMinor: num(r.total_minor),
    status: r.status as OrderStatus,
    isTest: Boolean(r.is_test),
    expiresAt: new Date(r.expires_at as string | Date),
  };
}

export function createOrder(
  db: V4Db,
  input: {
    botId: string;
    buyerId: string;
    country: string | null;
    productIds: string[];
    points?: number;
    isTest?: boolean;
    by: string;
  },
): Promise<V4Result<Order>> {
  return attempt(async () =>
    toOrder(
      one(
        await db.call("create_order", {
          p_bot_id: input.botId,
          p_buyer_id: input.buyerId,
          p_country: input.country,
          p_product_ids: input.productIds,
          p_points: input.points ?? 0,
          p_is_test: input.isTest ?? false,
          p_created_by: input.by,
        }),
        "create_order",
      ),
    ),
  );
}

export function recordPayment(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    method: LedgerMethod;
    /** Номер платежа у платёжки или ключ клика; повтор с тем же ключом — та же запись. */
    externalRef: string;
    by: string;
    note?: string;
  },
): Promise<V4Result<PaymentOutcome>> {
  return attempt(async () => {
    const r = one(
      await db.call("record_payment", {
        p_bot_id: input.botId,
        p_order_id: input.orderId,
        p_amount_minor: input.amountMinor,
        p_currency: input.currency,
        p_method: input.method,
        p_external_ref: input.externalRef,
        p_created_by: input.by,
        p_note: input.note ?? null,
      }),
      "record_payment",
    );
    return {
      entryId: num(r.entry_id),
      duplicate: Boolean(r.duplicate),
      becamePaid: Boolean(r.became_paid),
      orderClosed: Boolean(r.order_closed),
      currencyMismatch: Boolean(r.currency_mismatch),
      paidMinor: num(r.paid_minor),
      dueMinor: num(r.due_minor),
    };
  });
}

export function refund(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    amountMinor: number;
    reason: string;
    externalRef: string;
    by: string;
  },
): Promise<V4Result<number>> {
  return attempt(async () =>
    num(
      one(
        await db.call("refund", {
          p_bot_id: input.botId,
          p_order_id: input.orderId,
          p_amount_minor: input.amountMinor,
          p_reason: input.reason,
          p_external_ref: input.externalRef,
          p_created_by: input.by,
        }),
        "refund",
      ).refund,
    ),
  );
}

export function recordChargeback(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    method: LedgerMethod;
    externalRef: string;
    by: string;
  },
): Promise<V4Result<number>> {
  return attempt(async () =>
    num(
      one(
        await db.call("record_chargeback", {
          p_bot_id: input.botId,
          p_order_id: input.orderId,
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_method: input.method,
          p_external_ref: input.externalRef,
          p_created_by: input.by,
        }),
        "record_chargeback",
      ).record_chargeback,
    ),
  );
}

export type Receipt = {
  id: string;
  orderId: string;
  status: ReceiptStatus;
  /** Почему чек подозрительный; решает продавец (решение 55). */
  suspiciousReason: string | null;
};

export function submitReceipt(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    storagePath: string;
    /** sha256 файла чека, hex. */
    fingerprint: string;
    hint?: string;
    by?: string;
  },
): Promise<V4Result<Receipt>> {
  return attempt(async () => {
    const r = one(
      await db.call("submit_receipt", {
        p_bot_id: input.botId,
        p_order_id: input.orderId,
        p_storage_path: input.storagePath,
        p_fingerprint: input.fingerprint,
        p_hint: input.hint ?? null,
        p_created_by: input.by ?? "bot",
      }),
      "submit_receipt",
    );
    return {
      id: String(r.id),
      orderId: String(r.order_id),
      status: r.status as ReceiptStatus,
      suspiciousReason: (r.suspicious_reason as string | null) ?? null,
    };
  });
}

export function decideReceipt(
  db: V4Db,
  input: {
    botId: string;
    receiptId: string;
    by: string;
  } & ({ accept: true; amountMinor: number } | { accept: false; reason: string }),
): Promise<V4Result<{ decided: boolean; status: ReceiptStatus; becamePaid: boolean }>> {
  return attempt(async () => {
    const r = one(
      await db.call("decide_receipt", {
        p_bot_id: input.botId,
        p_receipt_id: input.receiptId,
        p_accept: input.accept,
        p_amount_minor: input.accept ? input.amountMinor : null,
        p_reject_reason: input.accept ? null : input.reason,
        p_decided_by: input.by,
      }),
      "decide_receipt",
    );
    return {
      decided: Boolean(r.decided),
      status: r.status as ReceiptStatus,
      becamePaid: Boolean(r.became_paid),
    };
  });
}

export function closeOrder(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    status: "expired" | "cancelled";
    reason: string;
    by: string;
  },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      one(
        await db.call("close_order", {
          p_bot_id: input.botId,
          p_order_id: input.orderId,
          p_status: input.status,
          p_reason: input.reason,
          p_created_by: input.by,
        }),
        "close_order",
      ).close_order,
    ),
  );
}

/** Истечение неоплаченных заказов одного магазина; крон вызывает по каждому клиенту v4. */
export async function expireOrders(db: V4Db, botId: string, now?: Date): Promise<number> {
  const args: Record<string, unknown> = { p_bot_id: botId };
  if (now) args.p_now = now.toISOString();
  return num(one(await db.call("expire_orders", args), "expire_orders").expire_orders);
}

/** Чем покупатель из этой страны может заплатить (решение 4: сказать до цены). */
export async function methodsFor(
  db: V4Db,
  botId: string,
  country: string | null,
): Promise<PaymentMethod[]> {
  const rows = await db.call("methods_for", { p_bot_id: botId, p_country: country });
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as PaymentMethodKind,
    country: (r.country as string | null) ?? null,
    currency: String(r.currency),
    details: String(r.details),
    feeBp: num(r.fee_bp),
  }));
}

/** Деньги по заказу из книги: оплачено, долг, состояние. null — заказа нет (или он чужой). */
export async function orderMoney(
  db: V4Db,
  botId: string,
  orderId: string,
): Promise<OrderMoney | null> {
  const rows = await db.call("money_of", { p_bot_id: botId, p_order_id: orderId });
  return rows[0] ? toOrderMoney(rows[0]) : null;
}

function toOrderMoney(r: Row): OrderMoney {
  return {
    orderId: String(r.order_id),
    no: num(r.no),
    currency: String(r.currency),
    totalMinor: num(r.total_minor),
    paidMinor: num(r.paid_minor),
    dueMinor: num(r.due_minor),
    state: r.money_state as MoneyState,
    unconfirmed: Boolean(r.unconfirmed),
    otherCurrency: Boolean(r.other_currency),
    isTest: Boolean(r.is_test),
  };
}
