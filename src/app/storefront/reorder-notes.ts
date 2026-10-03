import type { StorefrontKey, StorefrontT } from "@/app/i18n/storefront";
import type { ReorderSkip } from "@/core/storefront/reorder";

const KEY: Record<ReorderSkip["reason"], StorefrontKey> = {
  gone: "reorder.skip.gone",
  variant_gone: "reorder.skip.variant_gone",
  out_of_stock: "reorder.skip.out_of_stock",
  less: "reorder.skip.less",
};

/** Строки «чего не будет и почему» под кнопкой «Повторить заказ»; mixed — позиции, не подошедшие корзине по виду. */
export function reorderNotes(
  skipped: readonly ReorderSkip[],
  mixed: readonly string[],
  t: StorefrontT,
) {
  return [
    ...skipped.map((s) => t(KEY[s.reason], { name: s.name, left: s.left ?? 0 })),
    ...mixed.map((name) => t("reorder.skip.mixed", { name })),
  ];
}
