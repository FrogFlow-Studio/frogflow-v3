/**
 * Реестр настроек магазина: какие разделы есть на странице «Оплата и
 * настройки», к какой теме относятся и какие ключи `app_settings` правят.
 * По нему работают темы и поиск (А13); `registry.test.ts` не даёт новой
 * настройке или карточке остаться без записи.
 */
import type { AdminKey } from "@/app/i18n/admin";
import type { ModuleKey } from "@/core/modules/registry";

export const SETTINGS_THEMES = ["shop", "payment", "channels", "bots", "team", "advanced"] as const;
export type SettingsTheme = (typeof SETTINGS_THEMES)[number];

export type SettingsEntry = {
  /** Якорь раздела на странице: `#id`; совпадает с `<SettingsSection id>`. */
  id: string;
  theme: SettingsTheme;
  title: AdminKey;
  titleVars?: Record<string, string>;
  /** Ключи app_settings, которые правит раздел. */
  keys?: readonly string[];
  /** Названия полей раздела — поиск находит и по ним («часовой пояс»). */
  fields?: readonly AdminKey[];
  /** Раздел живёт на другой странице: ссылка вместо карточки. */
  to?: string;
  /** Раздел виден только при включённом модуле. */
  module?: ModuleKey;
  /** …или при включённом любом из этих. */
  anyModule?: readonly ModuleKey[];
  ownerOnly?: boolean;
  /** Карточка на две колонки. */
  wide?: boolean;
};

const E = (e: SettingsEntry) => e;

export const SETTINGS_REGISTRY: readonly SettingsEntry[] = [
  E({
    id: "shop",
    theme: "shop",
    title: "settings.shop.title",
    keys: [
      "shop_name",
      "shop_currency",
      "shop_tagline",
      "storefront_accent",
      "storefront_checkout",
      "admin_chat_id",
      "admin_contact_link",
      "instruction_caption",
      "delivery_email_note",
      "loyalty_earn_percent",
      "loyalty_max_redeem_percent",
      "delivery_lang_timing",
    ],
    fields: [
      "settings.shop.name",
      "settings.shop.currency",
      "settings.shop.timezone",
      "settings.shop.tagline",
      "settings.shop.accent",
      "settings.shop.contactLink",
      "settings.shop.loyaltyPercent",
    ],
  }),
  E({
    id: "legal",
    theme: "shop",
    title: "settings.legal.title",
    module: "legal_docs",
    wide: true,
    keys: ["legal_offer", "legal_privacy", "legal_requisites", "legal_about"],
  }),
  E({ id: "design", theme: "shop", title: "settings.design.title" }),
  E({ id: "marketplace", theme: "shop", title: "settings.market.title" }),
  E({ id: "community", theme: "shop", title: "settings.community.title" }),
  E({ id: "watermark", theme: "shop", title: "settings.watermark.title" }),
  E({ id: "gift-wrap", theme: "shop", title: "settings.giftWrap.title", module: "bundles" }),
  E({
    id: "smart-search",
    theme: "shop",
    title: "settings.ss.title",
    module: "smart_search",
    keys: [
      "smart_search_enabled",
      "smart_search_daily_count",
      "smart_search_daily_spend",
      "smart_search_lifetime_spend",
      "smart_search_last_error",
    ],
  }),
  E({
    id: "weekly",
    theme: "shop",
    title: "settings.weekly.title",
    keys: ["weekly_report_enabled"],
  }),
  E({ id: "payment-methods", theme: "payment", title: "settings.pay.title" }),
  E({
    id: "fulfillment",
    theme: "payment",
    title: "settings.ful.title",
    keys: [
      "fulfillment_pickup_enabled",
      "fulfillment_delivery_enabled",
      "payment_mode",
      "deposit_percent",
      "fulfillment_slots",
      "fulfillment_closed_weekdays",
      "fulfillment_closed_dates",
      "fulfillment_day_limit",
      "fulfillment_slot_limit",
    ],
  }),
  E({ id: "zones", theme: "payment", title: "settings.zones.title" }),
  E({ id: "free-delivery", theme: "payment", title: "settings.freeDelivery.title" }),
  E({ id: "min-order", theme: "payment", title: "settings.minOrder.title" }),
  E({
    id: "pay-remind",
    theme: "payment",
    title: "settings.payRemind.title",
    keys: ["chat_pay_reminder_hours"],
  }),
  E({
    id: "stars",
    theme: "payment",
    title: "settings.stars.title",
    module: "telegram_stars",
    keys: ["stars_rate"],
  }),
  E({
    id: "robokassa",
    theme: "payment",
    title: "settings.rk.title",
    module: "robokassa",
    wide: true,
    keys: [
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
    ],
  }),
  E({
    id: "receipt-ocr",
    theme: "payment",
    title: "settings.ocr.title",
    module: "receipt_ocr",
    keys: ["receipt_ocr_auto", "receipt_ocr_usage"],
  }),
  E({
    id: "crypto",
    theme: "payment",
    title: "settings.crypto.title",
    module: "crypto",
    ownerOnly: true,
    wide: true,
    keys: ["crypto_enabled", "nowpayments_api_key", "nowpayments_ipn_secret"],
  }),
  E({
    id: "stripe",
    theme: "payment",
    title: "settings.stripe.title",
    module: "stripe",
    ownerOnly: true,
    wide: true,
    keys: ["stripe_enabled", "stripe_secret_key", "stripe_webhook_secret"],
  }),
  E({ id: "telegram", theme: "channels", title: "settings.tg.title" }),
  E({
    id: "channel-wizard",
    theme: "channels",
    title: "settings.ch.title",
    anyModule: ["instagram", "whatsapp"],
    wide: true,
  }),
  E({
    id: "instagram-whatsapp",
    theme: "channels",
    title: "settings.ch.title",
    anyModule: ["instagram", "whatsapp"],
  }),
  E({
    id: "dbot-instagram",
    theme: "channels",
    title: "settings.dbot.title",
    titleVars: { channel: "Instagram" },
    module: "instagram",
  }),
  E({ id: "ice-breakers", theme: "channels", title: "settings.ib.title", module: "instagram" }),
  E({
    id: "dbot-whatsapp",
    theme: "channels",
    title: "settings.dbot.title",
    titleVars: { channel: "WhatsApp" },
    module: "whatsapp",
  }),
  E({
    id: "notify",
    theme: "bots",
    title: "settings.notify.title",
    module: "notify_in_bot",
    wide: true,
  }),
  E({ id: "low-stock", theme: "bots", title: "settings.lowStock.title", module: "stock" }),
  E({ id: "push", theme: "bots", title: "settings.push.title" }),
  E({
    id: "consultant",
    theme: "bots",
    title: "nav.consultant",
    to: "/admin/consultant",
    keys: [
      "consultant_enabled",
      "consultant_profile",
      "consultant_knowledge",
      "consultant_usage",
      "consultant_last_error",
    ],
  }),
  E({
    id: "vip",
    theme: "bots",
    title: "nav.vip",
    to: "/admin/vip",
    module: "vip",
    keys: [
      "vip_group_id",
      "vip_auto_confirm",
      "vip_payment_instructions",
      "vip_test_mode",
      "vip_warn_days",
      "vip_warn_days_2",
      "vip_welcome_message",
    ],
  }),
  E({
    id: "broadcast-limits",
    theme: "bots",
    title: "nav.broadcasts",
    to: "/admin/broadcasts",
    keys: ["cart_reminder_hours", "marketing_daily_cap"],
  }),
  E({
    id: "referral",
    theme: "bots",
    title: "nav.discounts",
    to: "/admin/discounts",
    keys: ["referral_discount_percent"],
  }),
  E({ id: "team", theme: "team", title: "settings.team.title", module: "admin_roles" }),
  E({ id: "invite", theme: "team", title: "invite.title", ownerOnly: true }),
  E({
    id: "crm",
    theme: "advanced",
    title: "settings.crm.title",
    module: "crm_integration",
    wide: true,
  }),
  E({
    id: "api",
    theme: "advanced",
    title: "settings.api.title",
    module: "public_api",
    ownerOnly: true,
    wide: true,
  }),
  E({ id: "takeout", theme: "advanced", title: "takeout.title", ownerOnly: true }),
  E({ id: "delete", theme: "advanced", title: "deletion.title", ownerOnly: true, wide: true }),
];

const BY_ID = new Map(SETTINGS_REGISTRY.map((e) => [e.id, e]));
export const settingsEntry = (id: string): SettingsEntry | undefined => BY_ID.get(id);

/** Запись попадает в поиск по названию раздела, названиям его полей и ключам настроек. */
export function entryMatches(
  e: SettingsEntry,
  query: string,
  text: (k: AdminKey, vars?: Record<string, string>) => string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    text(e.title, e.titleVars),
    e.id,
    ...(e.fields ?? []).map((f) => text(f)),
    ...(e.keys ?? []),
  ];
  return hay.some((h) => h.toLowerCase().includes(q));
}

/** Какие разделы менялись недавно: хотя бы одна из их настроек в `recent`. */
export function recentEntries(recentKeys: readonly string[]): Set<string> {
  const keys = new Set(recentKeys);
  return new Set(
    SETTINGS_REGISTRY.filter((e) => e.keys?.some((k) => keys.has(k))).map((e) => e.id),
  );
}

export const RECENT_DAYS = 7;

/** Раздел виден роли и набору модулей. */
export function entryVisible(
  e: SettingsEntry,
  shop: { role: string; modules: Partial<Record<string, boolean>> },
): boolean {
  if (e.ownerOnly && shop.role !== "owner") return false;
  if (e.anyModule && !e.anyModule.some((m) => shop.modules[m])) return false;
  return !e.module || Boolean(shop.modules[e.module]);
}
