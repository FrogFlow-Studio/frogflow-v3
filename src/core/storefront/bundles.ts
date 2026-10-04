import { bundleView, listBundles } from "@/core/bundles/bundle";
import { bundleStock } from "@/core/bundles/stock";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Набор товаров (модуль `bundles`) на витрине и в Mini App: состав и выгода
 * для карточки. Цена набора — его собственная (resolvePrice), выгода считается
 * по текущим ценам составляющих с акциями (core/bundles bundleView).
 */
export type StoreBundle = {
  parts: Array<{ name: string; variantName: string | null; qty: number }>;
  /** Выгода покупателя, в валюте набора; null — нет выгоды или цены не сопоставить. */
  saving: number | null;
  /** Сколько стоят составляющие по отдельности; null вместе с saving. */
  separateTotal: number | null;
  /** Все составляющие в продаже; иначе набор купить нельзя. */
  available: boolean;
  /** Сколько наборов собирается из остатка составляющих (Н2); null — предела нет или склад выключен. */
  capacity: number | null;
};

/** Id наборов магазина; без модуля — пусто и без чтения базы. */
export async function bundleIds(ctx: TenantContext): Promise<Set<string>> {
  if (!ctx.tenant.modules.bundles) return new Set();
  return new Set((await listBundles(ctx)).keys());
}

/** Данные наборов среди товаров страницы: id набора → состав. Остальные товары не попадают. */
export async function storeBundlesFor(
  ctx: TenantContext,
  productIds: readonly string[],
): Promise<Map<string, StoreBundle>> {
  const out = new Map<string, StoreBundle>();
  if (!ctx.tenant.modules.bundles || productIds.length === 0) return out;
  const all = await listBundles(ctx);
  for (const id of productIds) {
    const items = all.get(id);
    if (!items) continue;
    const view = await bundleView(ctx, id, items);
    if (!view) continue;
    out.set(id, {
      parts: view.items
        .filter((i) => i.name)
        .map((i) => ({ name: i.name!, variantName: i.variantName, qty: i.qty })),
      saving: view.saving != null && view.saving > 0 ? view.saving : null,
      separateTotal: view.saving != null && view.saving > 0 ? view.separateTotal : null,
      available: view.available,
      capacity: ctx.tenant.modules.stock ? await bundleStock(ctx, items) : null,
    });
  }
  return out;
}
