/**
 * Журнал склада (shop18-s-journal.spec.ts): магазин «Склад С8» — два товара с учётом остатка,
 * 51 движение по муке (причина «заказ») и один приход сахара.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.JRN18_SHOP_ID, ...r });
const eid = (n: number) => `e2e00000-0000-4000-8000-${String(185000 + n).padStart(12, "0")}`;

export function seedShop18SJournal(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.JRN18_SHOP_ID,
      bot_name: F.JRN18_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, stock: true, warehouse: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.JRN18_SHOP_SLUG,
        telegram: { username: "e2e_jrn18_bot", webhook_ok: true },
        admin: { username: F.JRN18_SELLER_LOGIN, password_hash: hash(F.JRN18_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000118,
      owner_name: "Продавец С8",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000118:E2E-jrn18-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  [
    [F.JRN18_FLOUR_ID, F.JRN18_FLOUR_NAME],
    [F.JRN18_SUGAR_ID, F.JRN18_SUGAR_NAME],
  ].forEach(([id, name], i) =>
    add(db, "products", [
      own({
        id,
        name,
        description: "Сырьё.",
        price: 500,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: "physical",
        stock_quantity: 100,
        lead_time_days: null,
        ...nulls([
          "file_path",
          "file_name",
          "file_url",
          "file_path_kz",
          "file_name_kz",
          "file_url_kz",
          "rating_avg",
        ]),
        rating_count: 0,
        sort_order: i,
        created_at: now,
      }),
    ]),
  );
  const t = Date.parse(now);
  const rows = Array.from({ length: F.JRN18_FLOUR_EVENTS }, (_, i) => ({
    id: eid(i + 1),
    event_id: `stock:e2e-jrn18-${i + 1}`,
    event_type: "stock.order",
    status: "event",
    error_message: null,
    payload: { product_id: F.JRN18_FLOUR_ID, from: 200 - i, to: 199 - i, actor: "system" },
    created_at: new Date(t - 60_000 * (i + 2)).toISOString(),
  }));
  rows.push({
    id: eid(900),
    event_id: "stock:e2e-jrn18-receipt",
    event_type: "stock.receipt",
    status: "event",
    error_message: null,
    payload: {
      product_id: F.JRN18_SUGAR_ID,
      from: 0,
      to: 100,
      receipt_no: 7,
      actor: "admin",
    } as never,
    created_at: new Date(t - 60_000).toISOString(),
  });
  add(
    db,
    "zernio_logs",
    rows.map((r) => own(r)),
  );
}
