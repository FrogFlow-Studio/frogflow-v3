import { loadBundle } from "@/core/bundles/bundle";
import { loadOrderGift, type OrderGift } from "@/core/orders/gift";
import { isGiftWrapRow } from "@/core/orders/gift-wrap";
import { getOrder } from "@/core/orders/orders";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inChunks } from "@/lib/in-chunks";

/**
 * Упаковочный лист (Н7): что и как класть в коробку. Лист кладут в посылку, а
 * подарок вскрывает другой человек, поэтому в нём нет ни одной цены, суммы,
 * оплаты, телефона и заметок продавца — только состав, получатель, открытка
 * и отметка об упаковке. Цены не уходят с сервера совсем: страница не может
 * их «просто не показать».
 */
export type PackingLine = {
  name: string;
  qty: number;
  /** Состав набора: что именно положить; пусто — обычный товар. */
  parts: Array<{ name: string; qty: number }>;
};

export type PackingSlip = {
  orderNo: number;
  createdAt: string;
  /** Дата выдачи/доставки (ISO), если задана. */
  date: string | null;
  fulfillmentType: string | null;
  gift: OrderGift | null;
  /** Подарочная упаковка заказана. */
  wrap: boolean;
  lines: PackingLine[];
};

export async function buildPackingSlip(
  ctx: TenantContext,
  orderId: number,
): Promise<PackingSlip | null> {
  const order = await getOrder(ctx, orderId);
  if (!order) return null;
  const gift = await loadOrderGift(ctx, orderId);
  const items = [...(order.order_items ?? [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  const wrap = items.some((i) => isGiftWrapRow(i.name_snapshot));
  const goods = items.filter((i) => !isGiftWrapRow(i.name_snapshot) && Number(i.quantity) > 0);

  // Состав наборов — по текущему описанию набора; названия — одним чтением на кусок.
  const compositions = new Map<string, Array<{ productId: string; qty: number }>>();
  if (ctx.tenant.modules.bundles)
    for (const id of new Set(goods.map((i) => i.product_id).filter(Boolean) as string[])) {
      const parts = await loadBundle(ctx, id);
      if (parts) compositions.set(id, parts);
    }
  const names = new Map<string, string>();
  const partIds = [...compositions.values()].flat().map((p) => p.productId);
  for (const r of await inChunks(
    partIds,
    (chunk) =>
      ctx.db.from("products").select("id, name").in("id", chunk) as unknown as PromiseLike<{
        data: Array<{ id: string; name: string }> | null;
        error: { message: string } | null;
      }>,
    "Упаковочный лист: состав набора",
  ))
    names.set(r.id, r.name);

  return {
    orderNo: Number(order.display_no ?? order.order_no ?? order.id),
    createdAt: order.created_at,
    date: order.fulfillment_at ?? null,
    fulfillmentType: order.fulfillment_type ?? null,
    gift,
    wrap,
    lines: goods.map((i) => {
      const qty = Number(i.quantity);
      return {
        name: i.name_snapshot,
        qty,
        parts: (compositions.get(i.product_id ?? "") ?? []).map((p) => ({
          name: names.get(p.productId) ?? "—",
          qty: p.qty * qty,
        })),
      };
    }),
  };
}
