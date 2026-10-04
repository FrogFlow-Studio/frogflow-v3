/**
 * Заявки поставщикам (shop18-s-requests.spec.ts): магазины «Склад С18-З», по одному на проект
 * Playwright. В основной магазин ничего не добавляем.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

export function seedShop18Requests(db: StubDb, now: string) {
  F.REQ18_SHOP_IDS.forEach((shopId, i) => {
    const own = <T extends object>(r: T) => ({ bot_id: shopId, ...r });
    add(db, "bots", [
      {
        id: shopId,
        bot_name: `Склад С18-З ${i + 1}`,
        status: "active",
        vertical: "digital",
        modules: { shop: true, dashboard: true, stock: true, warehouse: true },
        settings: {
          served_by: "v2",
          default_locale: "ru",
          slug: F.REQ18_SHOP_SLUGS[i],
          telegram: { username: `e2e_req18_${i}_bot`, webhook_ok: true },
          admin: {
            username: F.REQ18_SELLER_LOGINS[i],
            password_hash: hash(F.REQ18_SELLER_PASSWORD),
          },
        },
        paused_message: null,
        owner_telegram_id: 500001800 + i,
        owner_name: "Продавец С18-З",
        app_url: null,
        archived_at: null,
        bot_token: encrypt(`70000180${i}:E2E-req18-token`, F.SECRETS_KEY),
        subscription_plan: "business",
        subscription_expires_at: null,
        created_at: now,
      },
    ]);
    add(db, "app_settings", [
      own({ key: "shop_name", value: `Склад С18-З ${i + 1}`, updated_at: now }),
      own({ key: "low_stock_default", value: "5", updated_at: now }),
      own({
        key: "suppliers",
        value: JSON.stringify({
          rev: 1,
          items: [
            {
              id: F.REQ18_SUPPLIER_IDS[i],
              name: F.REQ18_SUPPLIER_NAME,
              contact: "",
              phone: "",
              note: "",
            },
          ],
        }),
        updated_at: now,
      }),
      own({
        key: `supplier_of:${F.REQ18_PRODUCT_IDS[i]}`,
        value: F.REQ18_SUPPLIER_IDS[i],
        updated_at: now,
      }),
    ]);
    [
      [F.REQ18_PRODUCT_IDS[i], F.REQ18_PRODUCT_NAME, 3],
      [F.REQ18_LOOSE_PRODUCT_IDS[i], F.REQ18_LOOSE_PRODUCT_NAME, 4],
    ].forEach(([id, name, stock], k) =>
      add(db, "products", [
        own({
          id,
          name,
          description: "Для заявки.",
          price: 1000,
          currency: "KZT",
          country_prices: {},
          is_active: true,
          category_ids: [],
          fulfillment_kind: "physical",
          stock_quantity: stock,
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
          sort_order: k,
          created_at: now,
        }),
      ]),
    );
  });
}
