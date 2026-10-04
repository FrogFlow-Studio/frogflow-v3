import { fakeDb } from "./fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

export const BOT = "00000000-0000-0000-0000-0000000000a1";
export const SET = "b0000000-0000-4000-8000-000000000001";
export const SHAMPOO = "b0000000-0000-4000-8000-000000000002";
export const BALM = "b0000000-0000-4000-8000-000000000003";
export const BALM_V = "c0000000-0000-4000-8000-000000000001";

/** Магазин с набором «Набор уход» = 2 шампуня + бальзам 250 мл (3000 ₸ при 5500 ₸ порознь). */
export function bundleShop(
  opts: {
    modules?: Record<string, boolean>;
    balmActive?: boolean;
    stock?: { shampoo?: number | null; balm?: number | null };
  } = {},
) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const prod = (id: string, name: string, price: number, extra = {}) => ({
    id,
    bot_id: BOT,
    name,
    price,
    currency: "KZT",
    country_prices: [],
    category_ids: [],
    is_active: true,
    fulfillment_kind: "physical",
    ...extra,
  });
  db.tables.products = [
    prod(SET, "Набор уход", 3000),
    prod(SHAMPOO, "Шампунь", 2000, { stock_quantity: opts.stock?.shampoo ?? null }),
    prod(BALM, "Бальзам", 1500, {
      is_active: opts.balmActive ?? true,
      stock_quantity: opts.stock?.balm ?? null,
    }),
  ];
  db.tables.product_variants = [
    { id: BALM_V, bot_id: BOT, product_id: BALM, name: "250 мл", price: 1500, sort_order: 0 },
  ];
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: `bundle:${SET}`,
      value: JSON.stringify({
        items: [
          { p: SHAMPOO, q: 2 },
          { p: BALM, v: BALM_V, q: 1 },
        ],
      }),
    },
  ];
  db.tables.order_items = [];
  db.tables.payment_methods = [];
  const ctx = {
    tenant: { id: BOT, modules: opts.modules ?? { bundles: true }, settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}
