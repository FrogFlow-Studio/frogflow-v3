/**
 * Факты оплаты для книги v4. Числовой номер заказа v3 сюда не попадает:
 * заказ v4 узнаётся только по uuid (`v4_order_id` или `order_id`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type V4Paid = {
  orderId: string;
  amountMinor: number;
  currency: string;
  externalRef: string;
};

function walk(value: unknown, bag: Record<string, string | number>, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 6) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((typeof v === "string" || typeof v === "number") && bag[k] === undefined) bag[k] = v;
    else if (v && typeof v === "object") walk(v, bag, depth + 1);
  }
}

/** null — это не заказ v4: вебхук отвечает 200 и в книгу не пишет. */
export function v4PaidFacts(payload: unknown): V4Paid | null {
  const bag: Record<string, string | number> = {};
  walk(payload, bag);
  const orderRaw = bag.v4_order_id ?? bag.order_id;
  const orderId = typeof orderRaw === "string" && UUID.test(orderRaw) ? orderRaw : null;
  if (!orderId) return null;
  const amountRaw = bag.amount_minor ?? bag.amount_total;
  const amountMinor = typeof amountRaw === "number" ? Math.round(amountRaw) : Number(amountRaw);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  const currency = String(bag.currency ?? "KZT").toUpperCase();
  const ref = bag.payment_intent ?? bag.external_ref ?? bag.id ?? bag.InvId;
  const externalRef = ref == null ? "" : String(ref);
  if (!externalRef) return null;
  return { orderId, amountMinor, currency, externalRef };
}
