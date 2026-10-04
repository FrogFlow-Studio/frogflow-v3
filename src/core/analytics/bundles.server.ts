import { bundleView, listBundles } from "@/core/bundles/bundle";
import { eachPage } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inChunks } from "@/lib/in-chunks";
import { bundleGiftStats, type BundleGiftStats, type BundleLine } from "./bundles";
import type { SaleOrder } from "./sales";

const DAY_MS = 86_400_000;
const GIFT_EVENT = /^order:(\d+):gift:once$/;

/** Наборы и подарки за последние `days` дней; без модуля наборов — null. */
export async function bundleGiftResults(
  ctx: TenantContext,
  days: number,
  now = new Date(),
): Promise<BundleGiftStats | null> {
  if (!ctx.tenant.modules.bundles) return null;
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();
  const orders = new Map<number, SaleOrder>();
  await eachPage<SaleOrder>(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, created_at, status, currency, fulfillment_kind")
        .gte("created_at", from)
        .lt("created_at", now.toISOString())
        .order("id")
        .range(a, b),
    "наборы и подарки: заказы",
    (rows) => {
      for (const o of rows) orders.set(Number(o.id), o);
    },
  );
  const lines: BundleLine[] = [];
  if (orders.size) {
    const ids = [...orders.keys()];
    const lo = Math.min(...ids);
    const hi = Math.max(...ids);
    await eachPage<BundleLine & { id: string }>(
      (a, b) =>
        ctx.db
          .from("order_items")
          .select("id, order_id, product_id, name_snapshot, quantity, price_snapshot")
          .gte("order_id", lo)
          .lte("order_id", hi)
          .order("id")
          .range(a, b),
      "наборы и подарки: позиции заказов",
      (rows) => {
        for (const l of rows) if (orders.has(Number(l.order_id))) lines.push(l);
      },
    );
  }
  const giftOrderIds = new Set<number>();
  await eachPage<{ id: string; event_id: string | null }>(
    (a, b) =>
      ctx.db
        .from("zernio_logs")
        .select("id, event_id")
        .eq("event_type", "order.gift")
        .gte("created_at", from)
        .order("id")
        .range(a, b),
    "наборы и подарки: подарки",
    (rows) => {
      for (const r of rows) {
        const m = GIFT_EVENT.exec(r.event_id ?? "");
        if (m) giftOrderIds.add(Number(m[1]));
      }
    },
  );

  // Составы — только у проданных наборов: цена выгоды считается по нынешним ценам.
  const sold = new Set(lines.map((l) => l.product_id).filter((id): id is string => !!id));
  const all = await listBundles(ctx);
  const soldBundles = [...all].filter(([id]) => sold.has(id));
  const names = new Map<string, string>();
  for (const r of await inChunks(
    soldBundles.map(([id]) => id),
    (chunk) =>
      ctx.db.from("products").select("id, name").in("id", chunk) as unknown as PromiseLike<{
        data: Array<{ id: string; name: string }> | null;
        error: { message: string } | null;
      }>,
    "наборы и подарки: названия",
  ))
    names.set(r.id, r.name);
  const savingPerUnit = new Map<string, { currency: string; amount: number }>();
  for (const [id, items] of soldBundles) {
    const view = await bundleView(ctx, id, items);
    if (view?.saving != null)
      savingPerUnit.set(id, { currency: view.currency, amount: view.saving });
  }
  return bundleGiftStats({
    orders,
    lines,
    giftOrderIds,
    bundles: new Map(soldBundles.map(([id]) => [id, names.get(id) ?? "—"])),
    savingPerUnit,
  });
}
