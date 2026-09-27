import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";

/**
 * Покупатель — строка bot_users, PK (bot_id, user_key).
 * user_key: tg_<id> | ig_<id> | wa_<id>. Одна таблица на все каналы, тот же
 * формат, что у v1, — покупатель, переехавший с v1, не теряет ни состояние,
 * ни корзину.
 */
/** `web` — покупатель, оформивший заказ на витрине сайта без мессенджера. */
export type Platform = "telegram" | "instagram" | "whatsapp" | "web";

export const USER_KEY_PREFIX: Record<Platform, string> = {
  telegram: "tg_",
  instagram: "ig_",
  whatsapp: "wa_",
  web: "web_",
};

export function userKey(platform: Platform, externalId: string | number): string {
  return `${USER_KEY_PREFIX[platform]}${externalId}`;
}

/**
 * Синтетический `telegram_id` покупателя из Instagram/WhatsApp — та же
 * формула, что в v1 (`zernioCustomerId`): отрицательное число из первых 13
 * шестнадцатеричных знаков sha256 от user_key. Корзина, заказы, чат с
 * менеджером и блокировки держатся на telegram_id, а (bot_id, telegram_id)
 * уникален — нулём, как писал ранний v2, второй покупатель Direct уже не
 * создался бы. Префикс канала в ключе разводит один номер в двух каналах.
 */
export function syntheticTelegramId(key: string): number {
  return -parseInt(createHash("sha256").update(key).digest("hex").slice(0, 13), 16);
}

/**
 * Состояние диалога — то же jsonb `bot_users.state`, что и в v1. Не машина
 * состояний, а типизированный набор известных ключей: опечатка в mode
 * ловится tsc, а не тихо проваливается в default.
 */
export type DialogMode =
  | "idle"
  | "search"
  | "awaiting_contact"
  | "awaiting_payment"
  | "awaiting_proof"
  | "choose_pay"
  | "awaiting_promo_code"
  | "awaiting_review_comment"
  | "awaiting_gift_certificate_code"
  | "awaiting_fulfillment_type"
  | "awaiting_fulfillment_date"
  | "awaiting_delivery_zone"
  | "awaiting_address"
  | "awaiting_fulfillment_note"
  /** Только Instagram/WhatsApp: у Direct нет /start, страна и вариант выбираются текстом. */
  | "awaiting_locale"
  | "awaiting_country"
  | "awaiting_variant_choice"
  /** multi_language, delivery_lang_timing = before: язык материалов перед оформлением. */
  | "awaiting_delivery_lang"
  /** helpdesk: покупатель описывает обращение одним сообщением. */
  | "awaiting_ticket"
  /** Instagram/WhatsApp: почта для выдачи письмом — до оформления или после чека. */
  | "awaiting_email"
  | "awaiting_order_email"
  /** Instagram/WhatsApp, модуль loyalty: «списать баллы?» перед оформлением. */
  | "awaiting_points_choice";

export type DialogState = {
  mode?: DialogMode;
  locale?: Locale;
  country_code?: string;
  country_name?: string;
  pending_order_id?: number;
  promo_code?: string;
  use_points?: boolean;
  gift_certificate_code?: string;
  placing_order?: boolean;
  checkout_fulfillment_type?: "pickup" | "delivery";
  checkout_fulfillment_at?: string;
  checkout_min_fulfillment_date?: string;
  checkout_delivery_zone_id?: string;
  checkout_delivery_zone_name?: string;
  checkout_delivery_fee?: number;
  checkout_fulfillment_address?: string;
  checkout_fulfillment_note?: string;
  /** Язык материалов, выбранный до оформления: код или "all". */
  delivery_lang?: string;
  /** Товар, для которого только что поставлена оценка и ждём комментарий. */
  review_product_id?: string;
  /** Кулдаун умного поиска — когда покупатель звал его последний раз. */
  last_smart_search_at?: string;
  /** История и пауза ИИ-консультанта (src/core/consultant). */
  consultant?: { [key: string]: Json | undefined };
  /** Магазин в Instagram/WhatsApp: показанный список, дедупликация ответов (src/channels/zernio/shop.server). */
  direct?: { [key: string]: Json | undefined };
  /** Лист ожидания: id товаров, о поступлении которых покупатель просил сообщить. */
  waitlist?: string[];
  [key: string]: Json | undefined;
};

type Row = Database["public"]["Tables"]["bot_users"]["Row"];

export type Customer = {
  userKey: string;
  platform: Platform;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  contactPhone: string | null;
  email: string | null;
  loyaltyPoints: number;
  state: DialogState;
  /** Диалог и аккаунт Zernio — куда отвечать покупателю из Instagram/WhatsApp. */
  zernioConversationId: string | null;
  zernioAccountId: string | null;
};

export function stateFromJson(json: Json | null | undefined): DialogState {
  return json && typeof json === "object" && !Array.isArray(json) ? (json as DialogState) : {};
}

/** Строка bot_users → покупатель; для выборок по состоянию (лист ожидания и т. п.). */
export function customerFromRow(r: Row): Customer {
  return fromRow(r);
}

function fromRow(r: Row): Customer {
  return {
    userKey: r.user_key,
    platform: (r.platform as Platform) || "telegram",
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    languageCode: r.language_code,
    contactPhone: r.contact_phone,
    email: r.email,
    loyaltyPoints: r.loyalty_points ?? 0,
    state: stateFromJson(r.state),
    zernioConversationId: r.zernio_conversation_id ?? null,
    zernioAccountId: r.zernio_account_id ?? null,
  };
}

export type Profile = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  /** Instagram/WhatsApp: диалог и аккаунт Zernio, телефон WhatsApp, профиль подписчика. */
  zernioConversationId?: string | null;
  zernioAccountId?: string | null;
  contactPhone?: string | null;
  metadata?: Record<string, Json>;
};

function mergeMetadata(
  prev: Json | null,
  next: Record<string, Json> | undefined,
): Json | undefined {
  if (!next || Object.keys(next).length === 0) return undefined;
  const base = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {};
  return { ...base, ...next };
}

/** Найти или создать покупателя; профиль обновляется, состояние — нет. */
export async function upsertCustomer(
  ctx: TenantContext,
  platform: Platform,
  externalId: string | number,
  profile: Profile,
): Promise<Customer> {
  const key = userKey(platform, externalId);
  const { data: existing } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("user_key", key)
    .maybeSingle();
  if (existing) {
    const metadata = mergeMetadata(existing.metadata, profile.metadata);
    const patch = {
      username: profile.username ?? existing.username,
      first_name: profile.firstName ?? existing.first_name,
      last_name: profile.lastName ?? existing.last_name,
      language_code: profile.languageCode ?? existing.language_code,
      zernio_conversation_id: profile.zernioConversationId ?? existing.zernio_conversation_id,
      zernio_account_id: profile.zernioAccountId ?? existing.zernio_account_id,
      contact_phone: profile.contactPhone ?? existing.contact_phone,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    const { data: updated } = await ctx.db
      .from("bot_users")
      .update(patch)
      .eq("user_key", key)
      .select("*")
      .single();
    return fromRow(updated ?? existing);
  }
  const telegramId = platform === "telegram" ? Number(externalId) : syntheticTelegramId(key);
  const { data: inserted, error } = await ctx.db
    .from("bot_users")
    .insert({
      bot_id: ctx.tenant.id,
      user_key: key,
      platform,
      telegram_id: telegramId,
      username: profile.username ?? null,
      first_name: profile.firstName ?? null,
      last_name: profile.lastName ?? null,
      language_code: profile.languageCode ?? null,
      zernio_conversation_id: profile.zernioConversationId ?? null,
      zernio_account_id: profile.zernioAccountId ?? null,
      contact_phone: profile.contactPhone ?? null,
      metadata: profile.metadata ?? {},
      state: {},
    })
    .select("*")
    .single();
  if (error || !inserted)
    throw new Error(`Не удалось создать покупателя ${key}: ${error?.message}`);
  return fromRow(inserted);
}

export async function getCustomer(ctx: TenantContext, key: string): Promise<Customer | null> {
  const { data } = await ctx.db.from("bot_users").select("*").eq("user_key", key).maybeSingle();
  return data ? fromRow(data) : null;
}

/** Покупатель по telegram_id — в том числе синтетическому (чат с менеджером хранит только его). */
export async function getCustomerByTelegramId(
  ctx: TenantContext,
  telegramId: number,
): Promise<Customer | null> {
  const { data } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data ? fromRow(data) : null;
}

/**
 * Записать состояние диалога. Страна покупателя не затирается пустым
 * значением: её спросили один раз, и она должна пережить любой сброс mode.
 */
export async function setState(
  ctx: TenantContext,
  customer: Customer,
  state: DialogState,
): Promise<Customer> {
  const next: DialogState = { ...state };
  if (!next.country_code && customer.state.country_code) {
    next.country_code = customer.state.country_code;
    next.country_name = customer.state.country_name;
  }
  const { error } = await ctx.db
    .from("bot_users")
    .update({ state: next as Json })
    .eq("user_key", customer.userKey);
  if (error)
    throw new Error(`Не удалось сохранить состояние ${customer.userKey}: ${error.message}`);
  return { ...customer, state: next };
}

export async function setContactPhone(
  ctx: TenantContext,
  customer: Customer,
  phone: string,
): Promise<Customer> {
  const { error } = await ctx.db
    .from("bot_users")
    .update({ contact_phone: phone })
    .eq("user_key", customer.userKey);
  if (error) throw new Error(`Не удалось сохранить телефон: ${error.message}`);
  return { ...customer, contactPhone: phone };
}

export async function setEmail(
  ctx: TenantContext,
  customer: Customer,
  email: string,
): Promise<Customer> {
  const { error } = await ctx.db
    .from("bot_users")
    .update({ email })
    .eq("user_key", customer.userKey);
  if (error) throw new Error(`Не удалось сохранить почту: ${error.message}`);
  return { ...customer, email };
}

export async function isBlocked(ctx: TenantContext, telegramId: number): Promise<boolean> {
  if (!ctx.tenant.modules.blocked) return false;
  const { data } = await ctx.db
    .from("blocked_users")
    .select("telegram_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return Boolean(data);
}
