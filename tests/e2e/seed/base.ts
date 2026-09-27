/**
 * То, что в настоящей базе делают ограничения, значения по умолчанию,
 * триггеры и RPC.
 */
import type { Row, StubDb } from "../pg-stub.ts";
import { nulls } from "./util.ts";

let orderSeq = 100;

export function seedBase(db: StubDb) {
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
}
