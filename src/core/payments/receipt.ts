/**
 * Чек 54-ФЗ для Robokassa в России (параметр Receipt): позиции заказа,
 * доставка, скидки. Сумма позиций обязана совпасть с OutSum до копейки,
 * иначе касса отклонит чек — скидку (промокод, баллы, сертификат) и
 * частичную оплату раскладываем на позиции пропорционально, остаток
 * округления — на последнюю. Чистый модуль.
 */
export const RECEIPT_SNO = ["osn", "usn_income", "usn_income_outcome", "esn", "patent"] as const;
export type ReceiptSno = (typeof RECEIPT_SNO)[number];
export const RECEIPT_TAX = [
  "none",
  "vat0",
  "vat5",
  "vat7",
  "vat10",
  "vat20",
  "vat22",
  "vat105",
  "vat107",
  "vat110",
  "vat120",
  "vat122",
] as const;
export type ReceiptTax = (typeof RECEIPT_TAX)[number];

export type ReceiptSettings = { sno: ReceiptSno | null; tax: ReceiptTax };

export type ReceiptItem = {
  name: string;
  quantity: number;
  sum: number;
  payment_method: "full_payment" | "prepayment" | "full_prepayment";
  payment_object: "service" | "commodity";
  tax: ReceiptTax;
};

export type Receipt = { sno?: ReceiptSno; items: ReceiptItem[] };

type Line = { name: string; quantity: number; amount: number };

const cents = (n: number) => Math.round(n * 100);
/** Имя позиции: без управляющих символов (касса их не примет), до 128 знаков. */
const clean = (s: string) =>
  [...s]
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("")
    .trim()
    .slice(0, 128) || "Товар";

/**
 * Позиции чека на сумму `outSum`. Заказ курса — услуга, физический — товар.
 * Частичная оплата (задаток) — «предоплата», полная до выдачи цифрового —
 * «полный расчёт» (выдача сразу после оплаты).
 */
export function receiptFor(
  order: {
    fulfillment_kind?: string | null;
    delivery_fee?: number | null;
    order_items?: Array<{ name_snapshot: string; quantity: number; price_snapshot: number }>;
  },
  outSum: number,
  settings: ReceiptSettings,
  fallbackName: string,
): Receipt {
  const physical = order.fulfillment_kind === "physical";
  const lines: Line[] = (order.order_items ?? [])
    .filter((i) => Number(i.quantity) > 0)
    .map((i) => ({
      name: clean(i.name_snapshot),
      quantity: Number(i.quantity),
      amount: Number(i.price_snapshot) * Number(i.quantity),
    }));
  if (Number(order.delivery_fee) > 0)
    lines.push({ name: "Доставка", quantity: 1, amount: Number(order.delivery_fee) });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const target = cents(outSum);
  const partial = total > 0 && target < cents(total) - 1;
  const base: Line[] =
    total > 0 && target > 0 ? lines : [{ name: clean(fallbackName), quantity: 1, amount: outSum }];
  const baseTotal = base.reduce((s, l) => s + l.amount, 0);
  // Раскладка суммы платежа по позициям в копейках, без потери копейки.
  let left = target;
  const sums = base.map((l, i) => {
    const share =
      i === base.length - 1 ? left : Math.round((cents(l.amount) * target) / cents(baseTotal));
    left -= share;
    return share;
  });
  const method = physical && partial ? "prepayment" : "full_payment";
  return {
    ...(settings.sno ? { sno: settings.sno } : {}),
    items: base.map((l, i) => ({
      name: l.name,
      quantity: l.quantity,
      sum: sums[i]! / 100,
      payment_method: method,
      payment_object: physical ? "commodity" : "service",
      tax: settings.tax,
    })),
  };
}

export function parseReceiptSettings(
  s: Record<string, string | undefined>,
): ReceiptSettings | null {
  if (s.robokassa_receipt !== "true") return null;
  const sno = RECEIPT_SNO.find((x) => x === s.robokassa_sno) ?? null;
  const tax = RECEIPT_TAX.find((x) => x === s.robokassa_tax) ?? "none";
  return { sno, tax };
}
