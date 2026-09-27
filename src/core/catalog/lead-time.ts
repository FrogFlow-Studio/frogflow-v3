/**
 * Срок изготовления имеет смысл только у физического товара: у цифрового он
 * мог остаться в строке от старой правки, но файл выдаётся сразу. Модуль
 * чистый — нужен и боту, и витрине в браузере.
 */
export function shownLeadDays(p: {
  fulfillment_kind: string | null;
  lead_time_days: number | null;
}): number | null {
  if (p.fulfillment_kind !== "physical") return null;
  const n = Number(p.lead_time_days) || 0;
  return n > 0 ? n : null;
}

export type CardBadge =
  | { key: "catalog.file" | "catalog.inStock" | "catalog.product" }
  | { key: "catalog.madeToOrder"; n: number };

/** Значок в углу карточки витрины. */
export function cardBadge(p: {
  kind: "digital" | "physical";
  leadTimeDays: number | null;
  inStock: boolean;
}): CardBadge {
  if (p.kind === "digital") return { key: "catalog.file" };
  if (p.leadTimeDays && p.leadTimeDays > 0)
    return { key: "catalog.madeToOrder", n: p.leadTimeDays };
  return { key: p.inStock ? "catalog.inStock" : "catalog.product" };
}
