import { pageAll } from "@/core/db/page";
import { reportError } from "@/lib/errors";
import { serverFailure } from "@/lib/server-failure";
import { getSettingsStrict, updateSettingStamped } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { COST_PREFIX, itemUnitCost, parseCost } from "./cost";

/**
 * Себестоимость в момент продажи (модуль `profit`): когда по заказу впервые
 * проходят деньги или выдача, себестоимость его позиций записывается в
 * app_settings `order_cost:<id заказа>`. Смена закупочной цены потом не
 * переписывает прошлые месяцы. Запись одна на заказ: условная по метке
 * времени, второй вызов (повтор события, два запроса сразу) её не трогает.
 *
 * Позиция: {"p": товар, "q": штук, "c": себестоимость штуки или null}. null —
 * на момент продажи себестоимость позиции не была задана; прибыль тогда
 * считается по текущей и помечается (core/profit/report). Если не задана ни у
 * одной позиции, снимок не пишется вовсе.
 */
export const ORDER_COST_PREFIX = "order_cost:";

export type SnapshotItem = { p: string | null; q: number; c: number | null };
export type OrderCostSnapshot = { cur: string; items: SnapshotItem[] };

export function parseSnapshot(raw: string | null | undefined): OrderCostSnapshot | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { cur?: unknown; items?: unknown };
    if (typeof j.cur !== "string" || !Array.isArray(j.items)) return null;
    const items: SnapshotItem[] = [];
    for (const i of j.items as Array<Record<string, unknown>>) {
      const q = Number(i.q);
      if (!Number.isFinite(q)) continue;
      items.push({
        p: typeof i.p === "string" ? i.p : null,
        q,
        c: typeof i.c === "number" && Number.isFinite(i.c) && i.c >= 0 ? i.c : null,
      });
    }
    return { cur: j.cur, items };
  } catch {
    return null;
  }
}

/**
 * Записать снимок, если его ещё нет. Не бросает: сбой уходит в Sentry, а
 * оплата и выдача идут дальше (снимка нет — прибыль возьмёт текущую себестоимость).
 * true — снимок записан этим вызовом.
 */
export async function snapshotOrderCost(ctx: TenantContext, orderId: number): Promise<boolean> {
  if (!ctx.tenant.modules.profit) return false;
  try {
    const key = `${ORDER_COST_PREFIX}${orderId}`;
    const exists = await ctx.db.from("app_settings").select("key").eq("key", key).maybeSingle();
    if (exists.error) throw serverFailure(`Снимок себестоимости: ${exists.error.message}`);
    if (exists.data) return false;

    const items = await pageAll<{
      product_id: string | null;
      product_variant_id: string | null;
      name_snapshot: string | null;
      quantity: number;
    }>(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("product_id, product_variant_id, name_snapshot, quantity")
          .eq("order_id", orderId)
          .order("id")
          .range(from, to),
      "позиции заказа для себестоимости",
    );
    const productIds = [...new Set(items.flatMap((i) => (i.product_id ? [i.product_id] : [])))];
    const variantIds = [
      ...new Set(items.flatMap((i) => (i.product_variant_id ? [i.product_variant_id] : []))),
    ];
    const costs = new Map<string, ReturnType<typeof parseCost>>();
    for (let i = 0; i < productIds.length; i += 200) {
      const chunk = productIds.slice(i, i + 200);
      const raw = await getSettingsStrict(
        ctx,
        chunk.map((id) => `${COST_PREFIX}${id}`),
      );
      for (const id of chunk) costs.set(id, parseCost(raw[`${COST_PREFIX}${id}`]));
    }
    const names = new Map<string, string>();
    for (let i = 0; i < variantIds.length; i += 200) {
      const { data, error } = await ctx.db
        .from("product_variants")
        .select("id, name")
        .in("id", variantIds.slice(i, i + 200));
      if (error) throw serverFailure(`Варианты для себестоимости: ${error.message}`);
      for (const v of data ?? []) names.set(v.id, v.name);
    }
    const { shopCurrency } = await import("@/core/discounts/discounts");
    const cur = await shopCurrency(ctx);
    const snap: OrderCostSnapshot = {
      cur,
      items: items.map((i) => {
        const c = i.product_id ? (costs.get(i.product_id) ?? null) : null;
        // Себестоимость в другой валюте магазина, чем сейчас, как не заданную не берём.
        const usable = c && c.currency === cur ? c : null;
        return {
          p: i.product_id,
          q: Number(i.quantity),
          c: itemUnitCost(usable, {
            variantId: i.product_variant_id,
            variantName: i.product_variant_id ? (names.get(i.product_variant_id) ?? null) : null,
            nameSnapshot: i.name_snapshot,
          }),
        };
      }),
    };
    // Ни у одной позиции себестоимость не задана — продавец ею не пользуется: строку не плодим,
    // прибыль возьмёт текущую себестоимость с пометкой «по текущей».
    if (snap.items.every((i) => i.c === null)) return false;
    const r = await updateSettingStamped(ctx, key, (raw) => (raw ? null : JSON.stringify(snap)));
    return r === "written";
  } catch (e) {
    await reportError(e, { where: "profit.snapshot", botId: ctx.tenant.id, extra: { orderId } });
    return false;
  }
}

/** Снимки заказов: id заказа → снимок. Ключи кусками по 200. */
export async function loadSnapshots(
  ctx: TenantContext,
  orderIds: readonly number[],
): Promise<Map<number, OrderCostSnapshot>> {
  const out = new Map<number, OrderCostSnapshot>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const raw = await getSettingsStrict(
      ctx,
      chunk.map((id) => `${ORDER_COST_PREFIX}${id}`),
    );
    for (const id of chunk) {
      const s = parseSnapshot(raw[`${ORDER_COST_PREFIX}${id}`]);
      if (s) out.set(id, s);
    }
  }
  return out;
}
