import { pageAll } from "@/core/db/page";
import { loadShopFx, rowsInBase } from "@/core/money/shop-fx";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { PACE_WINDOW_MS, salesPace, type PaceOrder, type SalesPace } from "./pace";

/** Один запрос за 50 часов (вчера и сегодня), постранично; сбой чтения — сбой, а не «продаж нет». */
export async function loadSalesPace(ctx: TenantContext, now = new Date()): Promise<SalesPace> {
  const since = new Date(now.getTime() - PACE_WINDOW_MS).toISOString();
  const [rows, fx] = await Promise.all([
    pageAll<PaceOrder & { id: number }>(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, created_at, total, paid_amount, currency, status, fulfillment_kind")
          .in("status", ["delivered", "accepted", "in_production", "ready"])
          .gte("created_at", since)
          .order("id", { ascending: true })
          .range(from, to),
      "Сегодня: продажи",
    ),
    loadShopFx(ctx),
  ]);
  // Другие валюты — в основной по курсу на сегодня (core/money/shop-fx).
  return salesPace(rowsInBase(fx, rows).rows, now, ctx.timezone);
}
