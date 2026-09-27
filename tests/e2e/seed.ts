/**
 * База сквозного прогона: один магазин цифровых товаров на v2 с товаром,
 * способом оплаты по чеку и Robokassa, продавцом и оператором. Плюс то, что в
 * настоящей базе делают значения по умолчанию, триггеры и RPC.
 */
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import * as F from "./fixtures.ts";
import { PIXEL_PNG, stubDb, type Row, type StubDb } from "./pg-stub.ts";

function encrypt(plain: string, hexKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

function hash(password: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt:${salt.toString("base64url")}:${h.toString("base64url")}`;
}

const nulls = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, null]));

let orderSeq = 100;

export function seedDb(): StubDb {
  const db = stubDb();
  const now = new Date().toISOString();

  db.unique = {
    app_settings: [["bot_id", "key"]],
    operator_settings: [["key"]],
    bot_users: [
      ["bot_id", "user_key"],
      ["bot_id", "telegram_id"],
    ],
    orders: [["bot_id", "order_no"]],
    zernio_logs: [["event_id"]],
    cart_items: [["bot_id", "user_key", "product_id", "product_variant_id"]],
    gift_certificates: [["bot_id", "code"]],
  };

  db.defaults = {
    // BIGSERIAL и нумерация заказа в магазине (триггеры assign_order_no, freeze_display_no).
    orders: (r, d) => {
      const no = (d.tables.orders ?? []).filter((o) => o.bot_id === r.bot_id).length + 1;
      return {
        id: ++orderSeq,
        order_no: no,
        display_no: no,
        platform: "telegram",
        total: 0,
        currency: "KZT",
        status: "awaiting_payment",
        delivery_index: 0,
        delivery_retry_count: 0,
        discount_amount: 0,
        points_used: 0,
        points_earned: 0,
        gift_certificate_discount: 0,
        fulfillment_kind: "digital",
        paid_amount: 0,
        delivery_fee: 0,
        ...nulls([
          "user_key",
          "zernio_conversation_id",
          "username",
          "display_name",
          "contact",
          "customer_email",
          "country_code",
          "country_name",
          "payment_proof_path",
          "payment_proof_hash",
          "admin_note",
          "delivery_lang_choice",
          "promo_code",
          "gift_certificate_code",
          "fulfillment_type",
          "fulfillment_at",
          "fulfillment_address",
          "fulfillment_note",
          "fulfillment_reminder_sent_at",
          "delivery_zone_id",
          "delivery_zone_name",
        ]),
      };
    },
    order_items: () => ({
      quantity: 1,
      material_files_snapshot: [],
      material_files_kz_snapshot: [],
      material_files_by_lang: {},
      ...nulls([
        "product_id",
        "product_variant_id",
        "file_path_snapshot",
        "file_name_snapshot",
        "file_url_snapshot",
        "file_path_kz_snapshot",
        "file_name_kz_snapshot",
        "file_url_kz_snapshot",
        "delivered_language",
      ]),
    }),
    bot_users: () => ({
      platform: "telegram",
      state: {},
      metadata: {},
      opt_out: false,
      loyalty_points: 0,
      ...nulls([
        "username",
        "first_name",
        "last_name",
        "language_code",
        "contact_phone",
        "email",
        "zernio_conversation_id",
        "zernio_account_id",
        "last_auto_dm_at",
        "cart_reminder_sent_at",
      ]),
    }),
    cart_items: () => ({ quantity: 1, product_variant_id: null, user_key: null }),
    app_settings: () => ({ value: null }),
    gift_certificates: () => ({
      status: "active",
      currency: "KZT",
      ...nulls(["note", "redeemed_by_telegram_id", "redeemed_order_id", "redeemed_at"]),
    }),
    zernio_logs: () => ({ status: "pending", payload: {}, error_message: null }),
    subscription_invoices: () => ({
      status: "sent",
      currency: "KZT",
      ...nulls([
        "note",
        "proof_path",
        "proof_uploaded_at",
        "created_by",
        "confirmed_at",
        "reject_reason",
      ]),
    }),
    subscription_payments: () => ({
      currency: "KZT",
      paid_at: new Date().toISOString(),
      note: null,
    }),
  };

  // trg_sync_subscription_expiry: срок подписки — самый поздний period_end.
  db.after.subscription_payments = (row, d) => {
    const bot = (d.tables.bots ?? []).find((b) => b.id === row.bot_id);
    if (!bot) return;
    const ends = (d.tables.subscription_payments ?? [])
      .filter((p) => p.bot_id === row.bot_id)
      .map((p) => String(p.period_end));
    bot.subscription_expires_at = ends.sort().at(-1) ?? null;
  };

  db.rpc = {
    // MIGRATION-27: захват оформления одним оператором.
    claim_order_placement: (d, args) => {
      const u = (d.tables.bot_users ?? []).find(
        (x) => x.bot_id === args.p_bot_id && Number(x.telegram_id) === Number(args.p_telegram_id),
      );
      if (!u) return false;
      const state = (u.state ?? {}) as Row;
      if (state.placing_order) return false;
      u.state = { ...state, placing_order: new Date().toISOString() };
      return true;
    },
    operator_bot_stats: () => [],
  };

  db.tables.bots = [
    {
      id: F.SHOP_ID,
      bot_name: F.SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: {
        robokassa: true,
        shop: true,
        web_storefront: true,
        gift_certificates: true,
        coupons: true,
        upsell: true,
        // Магазин в Instagram Direct (instagram-purchase.spec.ts).
        instagram: true,
        dm_shop: true,
      },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.SHOP_SLUG,
        telegram: { username: "e2e_shop_bot", webhook_ok: true },
        zernio: {
          profile_id: F.IG_PROFILE,
          account_ids: [F.IG_ACCOUNT],
          accounts: [{ id: F.IG_ACCOUNT, platform: "instagram", username: "e2e_shop" }],
        },
        admin: { username: F.SELLER_LOGIN, password_hash: hash(F.SELLER_PASSWORD) },
        // Продажа подарочных сертификатов на витрине (gift.spec.ts).
        gift_sale: { enabled: true, amounts: F.GIFT_AMOUNTS, currency: "KZT" },
      },
      paused_message: null,
      owner_telegram_id: F.SELLER_TG,
      owner_name: "Продавец E2E",
      app_url: null,
      archived_at: null,
      bot_token: encrypt(F.BOT_TOKEN, F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ];

  db.tables.operator_settings = [
    { key: "operator_username", value: F.OPERATOR_LOGIN },
    { key: "operator_password_hash", value: hash(F.OPERATOR_PASSWORD) },
    { key: "payout_requisites", value: "Kaspi Gold 4400 0000 0000 0000, E2E" },
  ];

  const shop = (r: Row) => ({ bot_id: F.SHOP_ID, ...r });
  const REVIEW_OK = "e2e00000-0000-4000-8000-0000000000e1";
  db.tables.app_settings = [
    ["shop_name", F.SHOP_NAME],
    ["robokassa_enabled", "true"],
    ["robokassa_test_mode", "false"],
    ["robokassa_login", F.ROBOKASSA.login],
    ["robokassa_pass1", F.ROBOKASSA.pass1],
    ["robokassa_pass2", F.ROBOKASSA.pass2],
    // Оформление на витрине сайта (web-checkout.spec.ts).
    ["storefront_checkout", '{"enabled":true}'],
    // «С этим берут»: к прописям — раскраска (web-checkout.spec.ts).
    ["upsell_rules", JSON.stringify({ [F.PRODUCT_ID]: [F.UPSELL_ID] })],
    // Отзывы на витрине: первый одобрен продавцом, второй ждёт решения.
    [`review_meta:${REVIEW_OK}`, '{"status":"approved","photos":[]}'],
  ].map(([key, value]) => shop({ key, value, updated_at: now }));
  db.tables.product_reviews = [
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
  ];

  db.tables.payment_methods = [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000b1",
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Переведите сумму на Kaspi Gold 4400 0000 0000 0000 и пришлите чек.",
      qr_code_path: null,
      is_active: true,
      sort_order: 0,
      created_at: now,
    }),
  ];

  db.tables.products = [
    shop({
      id: F.PRODUCT_ID,
      name: F.PRODUCT_NAME,
      description: "Сорок страниц прописей в PDF.",
      price: F.PRODUCT_PRICE,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      sort_order: 0,
      category_ids: [],
      fulfillment_kind: "digital",
      stock_quantity: null,
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
      created_at: now,
    }),
    shop({
      id: F.UPSELL_ID,
      name: F.UPSELL_NAME,
      description: "Раскраска в PDF.",
      price: 900,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      sort_order: 1,
      category_ids: [],
      fulfillment_kind: "digital",
      stock_quantity: null,
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
      created_at: now,
    }),
  ];
  db.tables.product_material_files = [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000c1",
      product_id: F.PRODUCT_ID,
      language: "ru",
      file_path: F.MATERIAL_PATH,
      file_name: "propisi.pdf",
      sort_order: 0,
      created_at: now,
    }),
    shop({
      id: "e2e00000-0000-4000-8000-0000000000c2",
      product_id: F.UPSELL_ID,
      language: "ru",
      file_path: F.MATERIAL_PATH,
      file_name: "raskraska.pdf",
      sort_order: 0,
      created_at: now,
    }),
  ];
  // Промокод для оформления на сайте (web-checkout.spec.ts).
  db.tables.promo_codes = [
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
  ];
  db.tables.product_images = [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000d1",
      product_id: F.PRODUCT_ID,
      image_path: `${F.SHOP_ID}/propisi.jpg`,
      sort_order: 0,
      created_at: now,
    }),
  ];
  db.tables.product_variants = [];
  db.tables.categories = [];

  // Фото товара: без него Instagram и WhatsApp шлют карточку без картинки.
  db.storage.set(`product-images/${F.SHOP_ID}/propisi.jpg`, { body: PIXEL_PNG, type: "image/png" });
  db.storage.set(`product-files/${F.MATERIAL_PATH}`, {
    body: Buffer.from("%PDF-1.4\n% e2e\n"),
    type: "application/pdf",
  });
  return db;
}
