/**
 * Витрина сайта демо-магазина: оформление и «С этим берут»
 * (web-checkout.spec.ts), промокод, подарочные сертификаты (gift.spec.ts) и
 * отзывы (storefront.spec.ts).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, addSettings, shop, shopBot } from "./util.ts";

const REVIEW_OK = "e2e00000-0000-4000-8000-0000000000e1";

export function seedStorefront(db: StubDb, now: string) {
  const bot = shopBot(db);
  bot.modules = {
    ...(bot.modules as object),
    web_storefront: true,
    gift_certificates: true,
    coupons: true,
    upsell: true,
  };
  // Продажа подарочных сертификатов на витрине.
  bot.settings = {
    ...(bot.settings as object),
    gift_sale: { enabled: true, amounts: F.GIFT_AMOUNTS, currency: "KZT" },
  };

  addSettings(db, now, [
    ["storefront_checkout", '{"enabled":true}'],
    // «С этим берут»: к прописям — раскраска.
    ["upsell_rules", JSON.stringify({ [F.PRODUCT_ID]: [F.UPSELL_ID] })],
    // Отзывы на витрине: первый одобрен продавцом, второй ждёт решения.
    [`review_meta:${REVIEW_OK}`, '{"status":"approved","photos":[]}'],
  ]);
  add(db, "product_reviews", [
    shop({
      id: REVIEW_OK,
      product_id: F.PRODUCT_ID,
      telegram_id: 900001,
      rating: 5,
      comment: "Ребёнок пишет с удовольствием",
      created_at: now,
      updated_at: now,
    }),
    shop({
      id: "e2e00000-0000-4000-8000-0000000000e2",
      product_id: F.PRODUCT_ID,
      telegram_id: 900002,
      rating: 1,
      comment: "Неодобренный отзыв",
      created_at: now,
      updated_at: now,
    }),
  ]);

  add(db, "promo_codes", [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000e1",
      code: F.PROMO_CODE,
      discount_type: "percent",
      discount_value: 10,
      used_count: 0,
      max_uses: null,
      valid_until: null,
      is_active: true,
      created_at: now,
    }),
  ]);
}
