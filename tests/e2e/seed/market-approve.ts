/**
 * «Материалы МО26» (market-approve.spec.ts): магазин на v2 с открытой витриной, согласия
 * на площадку в админке не давал — оператор включает показ по согласию, полученному в переписке.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add } from "./util.ts";

export function seedMarketApprove(db: StubDb, now: string) {
  const S = F.MA_SHOP;
  add(db, "bots", [
    {
      id: S.id,
      bot_name: S.name,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: { served_by: "v2", default_locale: "ru", slug: S.slug },
      paused_message: null,
      owner_telegram_id: null,
      owner_name: null,
      app_url: null,
      archived_at: null,
      bot_token: null,
      subscription_plan: "pro",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [{ bot_id: S.id, key: "shop_name", value: S.name, updated_at: now }]);
}
