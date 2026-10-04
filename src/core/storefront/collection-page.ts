import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeProductsByIds, type StoreProduct } from "./catalog";
import { parseCollections } from "./collections";

/**
 * Страница подборки: название и товары, которые покупатель видит сейчас.
 * Удалённый, скрытый и закончившийся (без предзаказа) товар не показывается;
 * порядок — как собрал продавец. Нет такой подборки — null.
 */
export async function storeCollection(
  ctx: TenantContext,
  id: string,
): Promise<{ id: string; name: string; items: StoreProduct[] } | null> {
  const c = parseCollections(ctx.tenant.settings.collections).find((x) => x.id === id);
  if (!c) return null;
  const products = await storeProductsByIds(ctx, c.product_ids);
  return { id: c.id, name: c.name, items: products.filter((p) => p.inStock || p.preorder) };
}
