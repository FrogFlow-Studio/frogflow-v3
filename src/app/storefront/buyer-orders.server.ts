import type { OrderItemRow, OrderWithItems } from "@/core/orders/orders";
import type { TenantContext } from "@/core/tenant/resolve.server";

import { LIBRARY_FILES } from "@/core/storefront/library";

export { LIBRARY_FILES };

/**
 * «Мои заказы» и библиотека материалов покупателя: общие для Mini App
 * (подпись initData) и сайта (вход через Telegram). Только заказы этого
 * покупателя в этом магазине (ctx.db — роль арендатора).
 */
export async function buyerOrders(ctx: TenantContext, telegramId: number, offset: number) {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  // Метки языка — только с модулем «Мультиязычность», как значки на витрине (#90).
  const libraryLangs = Boolean(ctx.tenant.modules.multi_language);
  if (!customer) return { orders: [], library: [], libraryNext: null, libraryLangs };
  const {
    listCustomerOrders,
    listDeliveredOrders,
    itemLanguages,
    itemMaterials,
    materialDownloadName,
    signedFileUrl,
    displayNo,
  } = await import("@/core/orders/orders");
  const { parseDeliveredLanguages } = await import("@/core/catalog/materials");
  const { protectMaterials } = await import("@/core/delivery/watermark.server");
  const [orders, deliveredOrders] = await Promise.all([
    listCustomerOrders(ctx, customer, 30),
    listDeliveredOrders(ctx, customer),
  ]);
  // Один товар — одна запись из самого свежего заказа (как в v1): повторная
  // покупка того же листа не дублирует его в библиотеке. Отбор — без походов
  // в Storage; тяжёлая часть — только для страницы.
  const seen = new Set<string>();
  const unique: Array<{ o: OrderWithItems; item: OrderItemRow }> = [];
  for (const o of deliveredOrders) {
    if (o.fulfillment_kind === "physical") continue;
    for (const item of o.order_items ?? []) {
      if (item.product_id) {
        if (seen.has(item.product_id)) continue;
        seen.add(item.product_id);
      }
      unique.push({ o, item });
    }
  }

  const { freshLibrary } = await import("@/core/storefront/library");
  const entries: Parameters<typeof freshLibrary>[1][number][] = [];
  let files = 0;
  let at = offset;
  for (; at < unique.length; at++) {
    const { o, item } = unique[at]!;
    const got = parseDeliveredLanguages(item.delivered_language);
    const langs = itemLanguages(item).filter((l) => got.size === 0 || got.has(l));
    const mats = langs.map((l) => itemMaterials(item, l));
    const count = mats.reduce((n, m) => n + m.length, 0);
    if (files > 0 && files + count > LIBRARY_FILES) break;
    files += count;
    for (const [i, m] of mats.entries()) {
      const list = await protectMaterials(ctx, o, m);
      for (const mat of list) {
        const url =
          mat.url ??
          (mat.path
            ? await signedFileUrl(
                mat.path,
                7 * 24 * 3600,
                materialDownloadName(mat, item.name_snapshot, list),
              )
            : null);
        if (url)
          entries.push({
            orderNo: displayNo(o),
            item: item.name_snapshot,
            name: mat.name ?? item.name_snapshot,
            url,
            lang: langs[i]!,
            productId: item.product_id,
          });
      }
    }
  }
  const libraryNext = at < unique.length ? at : null;
  // Название и обложка — какие у товара сейчас; файлы — из снимка заказа.
  const ids = [...new Set(entries.flatMap((e) => (e.productId ? [e.productId] : [])))];
  const { data: products } = ids.length
    ? await ctx.db
        .from("products")
        .select("id, name, product_images(image_path, sort_order)")
        .in("id", ids)
    : { data: [] };
  const library = freshLibrary(ctx.tenant.id, entries, products ?? []);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      no: displayNo(o),
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      createdAt: o.created_at,
      items: (o.order_items ?? []).map((i) => ({ name: i.name_snapshot, qty: i.quantity })),
    })),
    library,
    libraryNext,
    libraryLangs,
  };
}
