import { roleAllows, type AdminRole } from "@/core/auth/roles";

/** Настройки магазина в app_settings, которые читает страница настроек админки. */
export const SETTING_KEYS = [
  "shop_name",
  "shop_currency",
  "shop_tagline",
  "storefront_accent",
  "storefront_checkout",
  "stars_rate",
  "admin_chat_id",
  "admin_contact_link",
  "instruction_caption",
  "delivery_email_note",
  "cart_reminder_hours",
  "marketing_daily_cap",
  "chat_pay_reminder_hours",
  "chat_pay_reminder_hold",
  "chat_email_ask",
  "chat_email_optional",
  "chat_receipt_text",
  "chat_skip_chatter",
  "chat_keep_unread",
  "chat_foreign_pay",
  "chat_how_to_buy",
  "chat_several_items",
  "chat_product_request",
  "chat_pay_failed",
  "chat_receipt_text_offer",
  "chat_unpaid_number",
  "resend_old_confirm",
  "delivery_lang_timing",
  "loyalty_earn_percent",
  "loyalty_max_redeem_percent",
  "referral_discount_percent",
  "smart_search_enabled",
  "smart_search_daily_count",
  "smart_search_daily_spend",
  "smart_search_lifetime_spend",
  "smart_search_last_error",
  "receipt_ocr_auto",
  "receipt_ocr_deliver",
  "weekly_report_enabled",
  "weekly_report_sections",
  "auto_messages_v3",
  "notify_photo_not_receipt",
  "notify_bot_pause",
  "notify_chat_phone",
  "chat_phone_reply",
  "receipt_ocr_usage",
  "consultant_enabled",
  "consultant_comment_reply",
  "consultant_profile",
  "consultant_knowledge",
  "consultant_usage",
  "consultant_last_error",
  "fulfillment_pickup_enabled",
  "fulfillment_delivery_enabled",
  "payment_mode",
  "deposit_percent",
  "fulfillment_slots",
  "fulfillment_closed_weekdays",
  "fulfillment_closed_dates",
  "fulfillment_day_limit",
  "fulfillment_slot_limit",
  "legal_offer",
  "legal_privacy",
  "legal_requisites",
  "legal_about",
  "vip_group_id",
  "vip_auto_confirm",
  "vip_payment_instructions",
  "vip_payment_qr_path",
  "vip_test_mode",
  "vip_warn_days",
  "vip_warn_days_2",
  "vip_welcome_message",
  "robokassa_enabled",
  "robokassa_test_mode",
  "robokassa_login",
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
  "robokassa_region",
  "robokassa_receipt",
  "robokassa_sno",
  "robokassa_tax",
  "crypto_enabled",
  "nowpayments_api_key",
  "nowpayments_ipn_secret",
  "stripe_enabled",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "prodamus_enabled",
  "prodamus_form_url",
  "prodamus_secret_key",
  "prodamus_currency",
  "prodamus_rate",
  "kaspi_apipay_enabled",
  "kaspi_apipay_api_key",
  "kaspi_apipay_webhook_secret",
  "kaspi_apipay_test_mode",
  "card_all_prices",
] as const;

/**
 * Счётчики расходов и последние ошибки пишет только платформа: ими считаются
 * пределы тарифа на платные вызовы (чтение чеков, консультант, умный поиск).
 * Продавец их видит, но сбросить не может — иначе обнулил бы свой предел.
 */
const PLATFORM_ONLY = new Set<string>([
  "smart_search_daily_count",
  "smart_search_daily_spend",
  "smart_search_lifetime_spend",
  "smart_search_last_error",
  "receipt_ocr_usage",
  "consultant_usage",
  "consultant_last_error",
]);

type SettingKey = (typeof SETTING_KEYS)[number];

/** Что владелец может записать через saveSettingsFn. */
export const WRITABLE_SETTING_KEYS = SETTING_KEYS.filter((k) => !PLATFORM_ONLY.has(k)) as [
  SettingKey,
  ...SettingKey[],
];

/** Пароли Robokassa, ключи NOWPayments, Stripe, Продамуса и ApiPay видит только владелец: менеджеру и просмотру они ни к чему. */
const OWNER_ONLY_READ = [
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
  "nowpayments_api_key",
  "nowpayments_ipn_secret",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "prodamus_secret_key",
  "kaspi_apipay_api_key",
  "kaspi_apipay_webhook_secret",
] as const;

/**
 * Платежи магазина: ключи и режимы платёжных систем. Пишет только владелец; администратор
 * получает отказ на сервере (settings.functions saveSettingsFn), раздел ему не показывается.
 */
export const PAYMENT_SETTING_KEYS: ReadonlySet<string> = new Set([
  "robokassa_enabled",
  "robokassa_test_mode",
  "robokassa_login",
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
  "robokassa_region",
  "robokassa_receipt",
  "robokassa_sno",
  "robokassa_tax",
  "crypto_enabled",
  "nowpayments_api_key",
  "nowpayments_ipn_secret",
  "stripe_enabled",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "prodamus_enabled",
  "prodamus_form_url",
  "prodamus_secret_key",
  "prodamus_currency",
  "prodamus_rate",
  "kaspi_apipay_enabled",
  "kaspi_apipay_api_key",
  "kaspi_apipay_webhook_secret",
  "kaspi_apipay_test_mode",
  "stars_rate",
  "card_all_prices",
]);

export function settingsForRole<T extends Partial<Record<string, string>>>(
  settings: T,
  role: AdminRole,
): T {
  if (roleAllows(role, "owner")) return settings;
  const out = { ...settings };
  for (const k of OWNER_ONLY_READ) delete out[k];
  return out;
}

/** Длина обычной настройки и юридического текста (оферта бывает на десятки страниц). */
export const SETTING_VALUE_MAX = 4000;
export const LEGAL_TEXT_MAX = 200_000;

export function settingValueMax(key: string): number {
  return key.startsWith("legal_") ? LEGAL_TEXT_MAX : SETTING_VALUE_MAX;
}

/** Ключ первой настройки, чей текст длиннее своего предела, и сколько в нём символов. */
export function firstTooLongSetting(
  data: Record<string, string | undefined>,
): { key: string; length: number; max: number } | null {
  for (const [key, v] of Object.entries(data)) {
    const max = settingValueMax(key);
    if (v !== undefined && v.length > max) return { key, length: v.length, max };
  }
  return null;
}
