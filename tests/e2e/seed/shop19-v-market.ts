/** Каталог площадки (shop19-v-market.spec.ts): четыре магазина, показываются два. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add } from "./util.ts";

export function seedShop19VMarket(db: StubDb, now: string) {
  const S = F.MARKET19_SHOPS;
  const bot = (
    s: { id: string; name: string; slug: string },
    settings: Record<string, unknown>,
  ) => ({
    id: s.id,
    bot_name: s.name,
    status: "active",
    vertical: "confectionery",
    modules: { shop: true },
    settings: { default_locale: "ru", slug: s.slug, ...settings },
    paused_message: null,
    owner_telegram_id: null,
    owner_name: null,
    app_url: null,
    archived_at: null,
    bot_token: null,
    subscription_plan: "pro",
    subscription_expires_at: null,
    created_at: now,
  });
  const listed = { listed: true, approved: true };
  add(db, "bots", [
    bot(S.cake, { served_by: "v2", marketplace: { ...listed, category: "Торты", city: "Алматы" } }),
    bot(S.rose, { served_by: "v2", marketplace: { ...listed, category: "Цветы", city: "Астана" } }),
    bot(S.hidden, {
      served_by: "v2",
      marketplace: { ...listed, hidden: true, category: "Торты", city: "Алматы" },
    }),
    bot(S.old, { served_by: "v1", marketplace: { ...listed, category: "Торты", city: "Алматы" } }),
  ]);
  const row = (s: { id: string; name: string; slug: string }, category: string, city: string) => ({
    bot_id: s.id,
    slug: s.slug,
    name: s.name,
    category,
    city,
    rating: null,
    rating_count: 0,
    orders_month: 0,
    since: null,
    updated_at: now,
  });
  add(db, "marketplace_shops", [
    row(S.cake, "Торты", "Алматы"),
    row(S.rose, "Цветы", "Астана"),
    row(S.hidden, "Торты", "Алматы"),
    row(S.old, "Торты", "Алматы"),
  ]);
}
