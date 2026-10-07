/** Консультант «по прайсу» (bovi-stories.spec.ts): прайс 1С с новинкой в конце, свой товар в каталоге. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.BOVI_E2E_ID, ...r });
const row = (id: string, name: string, price: number) => ({
  id,
  name,
  category: "Blomus",
  size: "",
  colors: [],
  price_kzt: price,
  stock: true,
});

export function seedBoviStories(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.BOVI_E2E_ID,
      bot_name: F.BOVI_E2E_NAME,
      status: "active",
      vertical: "digital",
      modules: { instagram: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-bovi",
        telegram: { username: "e2e_bovi_bot", webhook_ok: true },
        consultant_pricelist: { enabled: true },
        zernio: {
          account_ids: [F.BOVI_E2E_IG],
          accounts: [{ id: F.BOVI_E2E_IG, platform: "instagram", username: "e2e_bovi" }],
        },
        admin: { username: F.BOVI_E2E_LOGIN, password_hash: hash(F.BOVI_E2E_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000230,
      owner_name: "Продавец прайса",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000230:E2E-bovi-token", F.SECRETS_KEY),
      subscription_plan: "pro",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const pricelist = [
    ...Array.from({ length: 60 }, (_, i) =>
      row(`old-${i}`, `BOVI Наволочки ${String(i).padStart(2, "0")}`, 25000),
    ),
    row("00-001", "Blomus Урна для мусора KORIE, цвет белый (Корзина для белья)", 90000),
    row("00-777", F.BOVI_E2E_NEW_ITEM, 74000),
  ];
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.BOVI_E2E_NAME, updated_at: now }),
    own({ key: "consultant_enabled", value: "true", updated_at: now }),
    own({ key: "consultant_catalog_json", value: JSON.stringify(pricelist), updated_at: now }),
    // Задача консультанта: передача менеджеру, которую продавец отмечает сделанной.
    own({
      key: "consultant_tasks_json",
      value: JSON.stringify([
        {
          id: "tsk_e2e1",
          at: now,
          userKey: "ig:e2e-bovi-1",
          reason: "purchase",
          text: F.BOVI_E2E_TASK_SUMMARY,
          contact: "+7 700 000 11 22",
          name: F.BOVI_E2E_TASK_CUSTOMER,
          channel: "instagram",
          products: [F.BOVI_E2E_NEW_ITEM],
          link: "https://ig.me/m/e2e_bovi_client",
          done: false,
        },
      ]),
      updated_at: now,
    }),
  ]);
  add(db, "products", [
    own({
      id: "e2e23000-0000-4000-8000-0000000000a1",
      name: F.BOVI_E2E_CATALOG_ITEM,
      price: 1000,
      currency: "KZT",
      is_active: true,
      created_at: now,
    }),
  ]);
}
