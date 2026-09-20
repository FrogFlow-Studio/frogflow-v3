import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";

/**
 * Покупатель — строка bot_users, PK (bot_id, user_key).
 * user_key: tg_<id> | ig_<id> | wa_<id>. Одна таблица на все каналы, тот же
 * формат, что у v1, — покупатель, переехавший с v1, не теряет ни состояние,
 * ни корзину.
 */
export type Platform = "telegram" | "instagram" | "whatsapp";

export const USER_KEY_PREFIX: Record<Platform, string> = {
  telegram: "tg_",
  instagram: "ig_",
  whatsapp: "wa_",
};

export function userKey(platform: Platform, externalId: string | number): string {
  return `${USER_KEY_PREFIX[platform]}${externalId}`;
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
  | "awaiting_address";

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
};

export function stateFromJson(json: Json | null | undefined): DialogState {
  return json && typeof json === "object" && !Array.isArray(json) ? (json as DialogState) : {};
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
  };
}

export type Profile = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
};

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
    const patch = {
      username: profile.username ?? existing.username,
      first_name: profile.firstName ?? existing.first_name,
      last_name: profile.lastName ?? existing.last_name,
      language_code: profile.languageCode ?? existing.language_code,
    };
    const { data: updated } = await ctx.db
      .from("bot_users")
      .update(patch)
      .eq("user_key", key)
      .select("*")
      .single();
    return fromRow(updated ?? existing);
  }
  // telegram_id NOT NULL в types.ts; для Instagram/WhatsApp v1 писал 0 —
  // ровно так и продолжаем, чтобы уникальный (bot_id, telegram_id) не мешал
  // (0 у одного бота бывает много раз только если индекс частичный — он
  // такой, см. docs/db-schema.md).
  const telegramId = platform === "telegram" ? Number(externalId) : 0;
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

export async function isBlocked(ctx: TenantContext, telegramId: number): Promise<boolean> {
  if (!ctx.tenant.modules.blocked) return false;
  const { data } = await ctx.db
    .from("blocked_users")
    .select("telegram_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return Boolean(data);
}
