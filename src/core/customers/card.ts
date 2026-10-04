import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { HANDOFF_PREFIX } from "@/core/storefront/handoff";
import { linkedWebOrderIds } from "@/core/storefront/web-link";
import {
  allSellerNotes,
  readSellerNoteVersioned,
  writeSellerNoteIf,
  type NoteResult,
  type SellerNote,
} from "./seller-notes";
import { linkedProfiles, type LinkedProfile } from "./identity";

export { cleanTags, type SellerNote } from "./seller-notes";

/**
 * Карточка покупателя в админке: профиль, каналы, заказы, обращения, заявки
 * воронки, последние сообщения чата и заметки продавца. Своей таблицы нет:
 * теги и заметка — строка app_settings `customer_note:<user_key>`
 * (core/customers/seller-notes).
 */
/** Заказ считается покупкой — как у аудитории «купившие» в рассылках. */
export const PURCHASE_STATUSES = ["delivered", "accepted", "in_production", "ready"] as const;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Откуда пришёл, для продавца. Ссылка с витрины `wc_<токен>` несёт токен
 * корзины — его не показываем, только что покупатель пришёл с витрины.
 */
export function sourceLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw.startsWith(HANDOFF_PREFIX) ? "storefront" : raw;
}

export type OrderStats = {
  count: number;
  /** Сумма покупок по валютам: у магазина с несколькими странами их несколько. */
  totals: Record<string, number>;
  firstAt: string | null;
  lastAt: string | null;
};

export function orderStats(
  orders: Array<{ status: string; total: number | string; currency: string; created_at: string }>,
): OrderStats {
  const paid = orders.filter((o) => (PURCHASE_STATUSES as readonly string[]).includes(o.status));
  const totals: Record<string, number> = {};
  for (const o of paid) totals[o.currency] = (totals[o.currency] ?? 0) + (Number(o.total) || 0);
  const dates = paid.map((o) => o.created_at).sort();
  return {
    count: paid.length,
    totals,
    firstAt: dates[0] ?? null,
    lastAt: dates.at(-1) ?? null,
  };
}

export type CardOrder = {
  id: number;
  no: number;
  /** Канал заказа: история общая для всех профилей покупателя (core/customers/identity). */
  platform: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
};

export type CustomerCard = {
  userKey: string;
  telegramId: number;
  platform: string;
  username: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  /** День рождения «MM-DD» (core/funnel/birthday). */
  birthday: string | null;
  points: number;
  createdAt: string;
  optOut: boolean;
  blocked: boolean;
  /** Откуда пришёл: первая ссылка /start (реферал, товар, корзина с витрины). */
  firstSource: string | null;
  seller: SellerNote;
  /** Версия заметки: форма возвращает её при сохранении, чтобы не затереть чужую правку. */
  sellerVersion: string | null;
  /** Этот же человек в других каналах: по телефону, почте или связи продавца. */
  linked: LinkedProfile[];
  stats: OrderStats;
  orders: CardOrder[];
  tickets: Array<{
    id: string;
    number: number;
    status: string;
    subject: string;
    createdAt: string;
  }>;
  leads: Array<{ id: string; stage: string; name: string; createdAt: string }>;
  messages: Array<{ direction: string; sender: string; text: string; createdAt: string }>;
};

const RECENT_ORDERS = 20;
const RECENT_MESSAGES = 10;

export async function customerCard(
  ctx: TenantContext,
  userKey: string,
): Promise<CustomerCard | null> {
  const { data: u, error } = await ctx.db
    .from("bot_users")
    .select(
      "user_key, telegram_id, platform, username, first_name, last_name, contact_phone, email, language_code, loyalty_points, created_at, opt_out, state",
    )
    .eq("user_key", userKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!u) return null;
  const telegramId = Number(u.telegram_id);
  const state = obj(u.state);
  const m = ctx.tenant.modules;

  // Привязанные покупателем заказы с сайта (core/storefront/web-link) — в ту же историю.
  const linkedIds = linkedWebOrderIds(state);
  const linked = await linkedProfiles(ctx, u);
  const buyerIds = [telegramId, ...linked.map((l) => l.telegramId)];
  const [ownOrders, blocked, tickets, leads, messages, seller, linkedOrders] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, order_no, display_no, status, total, currency, created_at, platform")
          .in("telegram_id", buyerIds)
          .order("id", { ascending: false })
          .range(from, to),
      "Заказы покупателя не прочитались",
    ),
    ctx.db
      .from("blocked_users")
      .select("telegram_id")
      .eq("telegram_id", telegramId)
      .maybeSingle()
      .then((r) => Boolean(r.data)),
    m.helpdesk
      ? ctx.db
          .from("zernio_logs")
          .select("id, status, payload, created_at")
          .like("event_id", "ticket:%")
          .contains("payload", { telegram_id: telegramId })
          .order("created_at", { ascending: false })
          .limit(20)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    m.crm_pipeline
      ? import("@/core/pipeline/leads").then(({ listLeads }) => listLeads(ctx))
      : Promise.resolve([]),
    m.manager_chat
      ? ctx.db
          .from("manager_chat_messages")
          .select("direction, sender, text, created_at")
          .in("telegram_id", buyerIds)
          .order("created_at", { ascending: false })
          .limit(RECENT_MESSAGES)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    readSellerNoteVersioned(ctx, userKey),
    linkedIds.length
      ? ctx.db
          .from("orders")
          .select("id, order_no, display_no, status, total, currency, created_at, platform")
          .in("id", linkedIds)
          .eq("platform", "web")
          .then((r) => {
            if (r.error) throw new Error(r.error.message);
            return r.data ?? [];
          })
      : Promise.resolve([]),
  ]);
  const own = new Set(ownOrders.map((o) => o.id));
  const orders = [...ownOrders, ...linkedOrders.filter((o) => !own.has(o.id))].sort(
    (a, b) => b.id - a.id,
  );

  const { displayNo } = await import("@/core/orders/pure");
  return {
    userKey: u.user_key,
    telegramId,
    platform: u.platform ?? "telegram",
    username: u.username,
    name: [u.first_name, u.last_name].filter(Boolean).join(" "),
    phone: u.contact_phone,
    email: u.email,
    language: typeof state.locale === "string" ? state.locale : u.language_code,
    country: typeof state.country_name === "string" ? state.country_name : null,
    birthday: typeof state.birthday === "string" ? state.birthday : null,
    points: Number(u.loyalty_points) || 0,
    createdAt: u.created_at,
    optOut: u.opt_out === true,
    blocked,
    firstSource: sourceLabel(state.first_source),
    seller: seller.note,
    sellerVersion: seller.version,
    linked,
    stats: orderStats(orders),
    orders: orders.slice(0, RECENT_ORDERS).map((o) => ({
      id: o.id,
      no: displayNo(o),
      platform: o.platform ?? "telegram",
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      createdAt: o.created_at,
    })),
    tickets: tickets.map((t) => {
      const p = obj(t.payload);
      return {
        id: t.id,
        number: Number(p.number) || 0,
        status: t.status === "pending" ? "waiting" : t.status,
        subject: typeof p.subject === "string" ? p.subject : "",
        createdAt: t.created_at,
      };
    }),
    leads: leads
      .filter((l) => l.user_key === userKey)
      .map((l) => ({ id: l.id, stage: l.stage, name: l.name, createdAt: l.created_at })),
    messages: messages
      .map((x) => ({
        direction: x.direction,
        sender: x.sender,
        text: x.text,
        createdAt: x.created_at,
      }))
      .reverse(),
  };
}

/**
 * Теги и заметка продавца с условием на версию (core/customers/seller-notes):
 * общая для карточки и диалога. null — такого покупателя нет.
 */
export async function setSellerNote(
  ctx: TenantContext,
  userKey: string,
  note: SellerNote,
  version: string | null,
): Promise<NoteResult | null> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("user_key")
    .eq("user_key", userKey)
    .maybeSingle();
  if (error) throw serverFailure(`Покупатели: ${error.message}`);
  if (!data) return null;
  return writeSellerNoteIf(ctx, userKey, note, version);
}

/** Все теги магазина — подсказки в карточке и выбор сегмента в рассылке. */
export async function knownTags(ctx: TenantContext): Promise<string[]> {
  const seen = new Map<string, string>();
  for (const n of (await allSellerNotes(ctx)).values())
    for (const t of n.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
