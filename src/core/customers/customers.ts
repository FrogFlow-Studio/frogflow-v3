import { inChunks } from "@/lib/in-chunks";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { serverFailure } from "@/lib/server-failure";
import { sha256Hex } from "@/lib/hash";

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
  return -parseInt(sha256Hex(key, 13), 16);
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
  /** Чек на остаток по задатку (core/orders/balance): заказ уже в работе. */
  | "awaiting_balance_proof"
  | "choose_pay"
  | "awaiting_promo_code"
  | "awaiting_review_comment"
  /** Instagram/WhatsApp: ждём цифру 1–5 на просьбу об оценке (core/reviews/ask). */
  | "awaiting_rating"
  /** Instagram/WhatsApp: квиз-подбор, ждём номер варианта (core/quiz). Теги — quiz_tags, вопрос — quiz_q. */
  | "awaiting_quiz"
  | "awaiting_gift_certificate_code"
  /** Instagram/WhatsApp: «это подарок?» — да/нет перед оформлением; затем имя получателя и текст открытки (core/orders/gift). */
  | "awaiting_gift_choice"
  | "awaiting_gift_recipient"
  | "awaiting_gift_message"
  /** Instagram/WhatsApp: «добавить подарочную упаковку?» — да/нет. */
  | "awaiting_gift_wrap"
  | "awaiting_fulfillment_type"
  | "awaiting_fulfillment_date"
  | "awaiting_fulfillment_slot"
  /** Фото готового заказа: ждём «да» или правки (core/orders/approval). */
  | "awaiting_approval"
  | "awaiting_approval_changes"
  /** Покупатель вводит день рождения по ссылке ?start=bday (core/funnel/birthday). */
  | "awaiting_birthday"
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
  | "awaiting_points_choice"
  /** Онлайн-школа: ответ на задание урока (hw_item, hw_lesson) — текстом, фото или файлом. */
  | "awaiting_homework";

export type DialogState = {
  mode?: DialogMode;
  locale?: Locale;
  country_code?: string;
  country_name?: string;
  /**
   * Вход на витрину по коду (В5, core/storefront/code-login): отпечатки метки браузера и
   * кода, срок, число попыток, отметка «использован». Самого кода здесь нет.
   */
  web_login?: {
    n?: string;
    c?: string;
    exp?: number;
    at?: number;
    tries?: number;
    used?: boolean;
    rev?: number;
  };
  /** Сохранённые адреса вошедшего покупателя (К5, core/storefront/addresses): список и версия секции. */
  web_addr?: { items?: { id: string; text: string }[]; rev?: number };
  /** Номер, который покупатель прислал в переписке вне шага «жду телефон» (Б2); контакт для продавца. */
  phone?: string;
  /** Когда бот последний раз отвечал «вне часов работы» (core/bot-texts): не чаще раза в 6 часов. */
  off_hours_at?: string;
  pending_order_id?: number;
  /** Заказ, фото которого покупатель согласует (core/orders/approval). */
  approval_order_id?: number;
  promo_code?: string;
  use_points?: boolean;
  gift_certificate_code?: string;
  /** Заказ отмечен подарком: получатель и открытка, уходят в placeOrder и снимаются после него. */
  gift_on?: boolean;
  gift_recipient?: string;
  gift_message?: string;
  /** К подарку выбрана подарочная упаковка (core/orders/gift-wrap). */
  gift_wrap?: boolean;
  /** Instagram/WhatsApp: про подарок уже спросили в этом оформлении. */
  gift_asked?: boolean;
  /** Instagram/WhatsApp: на непонятный ответ про подарок или упаковку уже переспросили один раз. */
  gift_reask?: boolean;
  placing_order?: boolean;
  /**
   * Цены во всех валютах (core/pricing/all-prices): страну оплаты в этом
   * оформлении ещё не выбрали — спросить с суммами перед заказом.
   */
  pay_choice_pending?: boolean;
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
  /** Когда ушла просьба об оценке в Direct/WhatsApp: цифра принимается в окне ответа (24 ч). */
  review_ask_at?: string;
  /** Заказ, по которому идёт просьба об оценке в Direct/WhatsApp: после оценки спрашиваем следующий товар. */
  review_order_id?: number;
  /** Кулдаун умного поиска — когда покупатель звал его последний раз. */
  last_smart_search_at?: string;
  /** История и пауза ИИ-консультанта (src/core/consultant). */
  consultant?: { [key: string]: Json | undefined };
  /** Магазин в Instagram/WhatsApp: показанный список, дедупликация ответов (src/channels/zernio/shop.server). */
  direct?: { [key: string]: Json | undefined };
  /** Лист ожидания: id товаров, о поступлении которых покупатель просил сообщить. */
  waitlist?: string[];
  /**
   * Покупатель из Telegram: заказы с сайта, оформленные до входа по почте и
   * привязанные им по подписанной ссылке заказа (core/storefront/web-link).
   */
  web_orders?: number[];
  /** Покупатель сайта (по почте): какой заказ к какому Telegram привязан. */
  telegram_links?: { [orderId: string]: number };
  /** Счётчики условной записи web_orders / telegram_links (core/storefront/web-link). */
  web_orders_v?: number;
  telegram_links_v?: number;
  /** Онлайн-школа: какое задание сдаёт ученик и альбом, который уже начал приходить. */
  hw_item?: string;
  hw_lesson?: string;
  hw_group?: string;
  /** Онлайн-школа: тест к уроку в боте, вопрос за вопросом (channels/telegram/course-quiz). */
  qz?: { [key: string]: Json | undefined };
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
  const { data: existing, error: existingError } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("user_key", key)
    .maybeSingle();
  if (existingError) throw serverFailure(`Покупатели: ${existingError.message}`);
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
    const { data: updated, error: updatedError } = await ctx.db
      .from("bot_users")
      .update(patch)
      .eq("user_key", key)
      .select("*")
      .single();
    // Покупатель найден, обновление профиля — попутное: сбой не обрывает разговор.
    if (updatedError)
      console.error(`[customers] профиль ${key} не обновлён: ${updatedError.message}`);
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
    throw serverFailure(`Не удалось создать покупателя ${key}: ${error?.message}`);
  return fromRow(inserted);
}

export async function getCustomer(ctx: TenantContext, key: string): Promise<Customer | null> {
  const { data, error: dataError } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("user_key", key)
    .maybeSingle();
  if (dataError) throw serverFailure(`Покупатели: ${dataError.message}`);
  return data ? fromRow(data) : null;
}

/** Покупатель по telegram_id — в том числе синтетическому (чат с менеджером хранит только его). */
export async function getCustomerByTelegramId(
  ctx: TenantContext,
  telegramId: number,
): Promise<Customer | null> {
  const { data, error: dataError } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (dataError) throw serverFailure(`Покупатели: ${dataError.message}`);
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
    throw serverFailure(`Не удалось сохранить состояние ${customer.userKey}: ${error.message}`);
  return { ...customer, state: next };
}

/**
 * Обновить один раздел состояния диалога (объект в `state[key]`), не затирая
 * то, что записали параллельно. Состояние перечитывается прямо перед записью,
 * запись — с условием на маленький счётчик `state[key].rev` и на `state.mode`;
 * промах — перечитать и повторить. Для долгих обработчиков (консультант думает
 * до 35 с), у которых снимок покупателя успевает устареть.
 */
export async function updateStateSection(
  ctx: TenantContext,
  customer: Customer,
  key: "consultant" | "direct" | "winback" | "web_fav" | "web_login" | "web_addr",
  patch: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Customer> {
  return (await claimStateSection(ctx, customer, key, patch))!;
}

/**
 * То же, но `patch` может вернуть null — «уже сделано другим»: тогда ничего не
 * пишем и возвращаем null. Условие вычисляется на свежем состоянии каждой
 * попытки, поэтому из двух кронов, дошедших до покупателя в одно время, дело
 * (например, напоминание) достаётся одному: второй, переприменив запись на
 * свежем состоянии, видит метку первого и уступает.
 */
export async function claimStateSection(
  ctx: TenantContext,
  customer: Customer,
  key: "consultant" | "direct" | "winback" | "funnel" | "web_fav" | "web_login" | "web_addr",
  patch: (current: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<Customer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("user_key", customer.userKey)
      .maybeSingle();
    if (error)
      throw serverFailure(`Не удалось прочитать состояние ${customer.userKey}: ${error.message}`);
    if (!data) throw serverFailure(`Покупатель ${customer.userKey} не найден`);
    const state = (data.state ?? {}) as DialogState;
    const raw = state[key];
    const current =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const rev = typeof current.rev === "number" ? current.rev : null;
    const changed = patch(current);
    if (changed === null) return null;
    const next: DialogState = { ...state, [key]: { ...changed, rev: (rev ?? 0) + 1 } };
    const base = ctx.db
      .from("bot_users")
      .update({ state: next as Json })
      .eq("user_key", customer.userKey);
    const byRev =
      rev == null
        ? base.is(`state->${key}->>rev`, null)
        : base.eq(`state->${key}->>rev`, String(rev));
    const mode = typeof state.mode === "string" && state.mode ? state.mode : null;
    const { data: written, error: werr } = await (
      mode == null ? byRev.is("state->>mode", null) : byRev.eq("state->>mode", mode)
    ).select("user_key");
    if (werr)
      throw serverFailure(`Не удалось сохранить состояние ${customer.userKey}: ${werr.message}`);
    if (written?.length) return { ...customer, state: next };
  }
  throw serverFailure(`Состояние ${customer.userKey} меняется параллельно, запись не удалась`);
}

/**
 * Записать номер, присланный в переписке, точечно: условие на маленькие поля
 * (`state.mode`, `state.phone`), чтобы не затереть то, что параллельно пишут
 * бот и v1. `fresh: false` — этот номер уже записан (повтор вебхука): отвечать
 * второй раз не нужно.
 */
export async function noteChatPhone(
  ctx: TenantContext,
  customer: Customer,
  phone: string,
): Promise<{ customer: Customer; fresh: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("user_key", customer.userKey)
      .maybeSingle();
    if (error)
      throw serverFailure(`Не удалось прочитать состояние ${customer.userKey}: ${error.message}`);
    if (!data) throw serverFailure(`Покупатель ${customer.userKey} не найден`);
    const state = (data.state ?? {}) as DialogState;
    if (state.phone === phone) return { customer: { ...customer, state }, fresh: false };
    const next: DialogState = { ...state, phone };
    const base = ctx.db
      .from("bot_users")
      .update({ state: next as Json })
      .eq("user_key", customer.userKey);
    const byPhone =
      state.phone == null ? base.is("state->>phone", null) : base.eq("state->>phone", state.phone);
    const mode = typeof state.mode === "string" && state.mode ? state.mode : null;
    const { data: written, error: werr } = await (
      mode == null ? byPhone.is("state->>mode", null) : byPhone.eq("state->>mode", mode)
    ).select("user_key");
    if (werr)
      throw serverFailure(`Не удалось сохранить состояние ${customer.userKey}: ${werr.message}`);
    if (written?.length) return { customer: { ...customer, state: next }, fresh: true };
  }
  throw serverFailure(`Состояние ${customer.userKey} меняется параллельно, запись не удалась`);
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
  if (error) throw serverFailure(`Не удалось сохранить телефон: ${error.message}`);
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
  if (error) throw serverFailure(`Не удалось сохранить почту: ${error.message}`);
  return { ...customer, email };
}

/**
 * Кто из этих покупателей заблокирован — один запрос на кусок из 200 id, а не
 * по запросу на каждого. Не прочиталось — `serverFailure`, а не «никто не
 * заблокирован»: иначе заблокированным ушла бы рассылка.
 */
export async function blockedAmong(
  ctx: TenantContext,
  telegramIds: readonly number[],
): Promise<Set<number>> {
  if (!ctx.tenant.modules.blocked || !telegramIds.length) return new Set();
  const rows = await inChunks(
    telegramIds,
    (chunk) => ctx.db.from("blocked_users").select("telegram_id").in("telegram_id", chunk),
    "Покупатели: блокировки",
  );
  return new Set(rows.map((r) => Number(r.telegram_id)));
}

export async function isBlocked(ctx: TenantContext, telegramId: number): Promise<boolean> {
  if (!ctx.tenant.modules.blocked) return false;
  const { data, error: dataError } = await ctx.db
    .from("blocked_users")
    .select("telegram_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (dataError) throw serverFailure(`Покупатели: ${dataError.message}`);
  return Boolean(data);
}
