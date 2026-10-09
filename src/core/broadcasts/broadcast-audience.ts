import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { adminRecipients } from "@/core/notify/recipients";
import { isRealTelegramChat, type AudienceType } from "./pure";
import { parseSegment, segmentMembers } from "./segments";
import { loadMarketingCap, marketingAllowed } from "@/core/marketing/cap";
import { stateFromJson } from "@/core/customers/customers";
import { type AudienceFilter } from "./broadcast-model";

/** Аудитория рассылки: покупатели Telegram и номера WhatsApp. */

/** Получатель WhatsApp-рассылки: номер плюс синтетический ключ покупателя. */
export type WhatsAppRecipient = { telegramId: number; phone: string };

function phoneOf(u: { user_key: string; contact_phone: string | null }): string {
  const raw =
    u.contact_phone?.replace(/\D/g, "") ||
    (u.user_key.startsWith("wa_") ? u.user_key.slice(3) : "");
  return /^\d{10,15}$/.test(raw) ? raw : "";
}

/** Список номеров, которым продавец обещал не писать (настройка whatsapp_bot_excluded_phones). */
export function parseExcludedPhones(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,;\n]+/)
      .map((x) => x.replace(/\D/g, ""))
      .filter((x) => x.length >= 10),
  );
}

/**
 * Кому уходит WhatsApp-рассылка: покупатели из WhatsApp с номером, без
 * отписавшихся и исключённых. «Себе на пробу» здесь нет — у продавца в базе
 * нет своей записи покупателя, пустой список честнее отправки непонятно кому.
 */
export async function resolveWhatsAppAudience(
  ctx: TenantContext,
  type: AudienceType,
  filter: AudienceFilter = {},
): Promise<WhatsAppRecipient[]> {
  if (type === "test") return [];
  const { getSetting } = await import("@/core/settings/settings");
  const excluded = parseExcludedPhones(await getSetting(ctx, "whatsapp_bot_excluded_phones"));
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, user_key, contact_phone, state, opt_out")
        .eq("platform", "whatsapp")
        .order("user_key")
        .range(from, to),
    "получатели WhatsApp",
  );
  let buyers: Set<string> | null = null;
  if (type === "buyers" || type === "non_buyers") {
    const orders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("user_key")
          .in("status", [...BUYER_STATUSES])
          .eq("platform", "whatsapp")
          .order("id")
          .range(from, to),
      "покупатели WhatsApp",
    );
    buyers = new Set(orders.map((o) => String(o.user_key ?? "")).filter(Boolean));
  }
  const code = filter.country_code?.trim().toUpperCase();
  return users
    .filter((u) => !u.opt_out)
    .filter((u) => (buyers ? buyers.has(u.user_key) === (type === "buyers") : true))
    .filter((u) =>
      type === "country"
        ? Boolean(code) &&
          String(
            (u.state as { country_code?: string } | null)?.country_code ?? "",
          ).toUpperCase() === code
        : true,
    )
    .map((u) => ({ telegramId: Number(u.telegram_id), phone: phoneOf(u) }))
    .filter((r) => r.phone && !excluded.has(r.phone));
}

/** Статусы заказов, по которым человек считается покупателем: оплаченный
 *  цифровой (delivered) и физический с принятым задатком в работе. */
export const BUYER_STATUSES = ["delivered", "accepted", "in_production", "ready"] as const;

/**
 * Кому уходит рассылка. Только настоящие Telegram-чаты: у покупателей из
 * Instagram/WhatsApp telegram_id синтетический (отрицательный), чата с таким
 * номером не существует.
 */
export async function resolveAudience(
  ctx: TenantContext,
  type: AudienceType,
  filter: AudienceFilter = {},
): Promise<number[]> {
  if (type === "test") {
    return (await adminRecipients(ctx)).map(Number).filter(isRealTelegramChat);
  }

  // Отписавшиеся и заблокированные не получают рассылок ни в какой аудитории,
  // в том числе «купившие»: покупатель мог купить, а потом отписаться.
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, user_key, state, opt_out")
        .eq("platform", "telegram")
        .order("user_key")
        .range(from, to),
    "получатели рассылки",
  );
  const blocked = await blockedIds(ctx);
  const reachable = users
    .filter((u) => !u.opt_out)
    .map((u) => ({ id: Number(u.telegram_id), userKey: u.user_key, state: u.state }))
    .filter((u) => isRealTelegramChat(u.id) && !blocked.has(u.id));

  const buyers = async () => {
    const orders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id")
          .in("status", [...BUYER_STATUSES])
          .eq("platform", "telegram")
          .order("id")
          .range(from, to),
      "покупатели для рассылки",
    );
    return new Set(orders.map((o) => Number(o.telegram_id)).filter(isRealTelegramChat));
  };

  if (type === "buyers") {
    const b = await buyers();
    return reachable.filter((u) => b.has(u.id)).map((u) => u.id);
  }
  if (type === "non_buyers") {
    const b = await buyers();
    return reachable.filter((u) => !b.has(u.id)).map((u) => u.id);
  }
  if (type === "country") {
    const code = filter.country_code?.trim().toUpperCase();
    if (!code) return [];
    return reachable
      .filter(
        (u) =>
          String(
            (u.state as { country_code?: string } | null)?.country_code ?? "",
          ).toUpperCase() === code,
      )
      .map((u) => u.id);
  }
  const segment = parseSegment(filter.segment);
  if (segment) {
    const members = await segmentMembers(ctx, segment, reachable, BUYER_STATUSES);
    const picked = reachable.filter((u) => members.has(u.id));
    if (segment.kind !== "broadcast") return picked.map((u) => u.id);
    // «Дослать» — второе касание: тем, у кого сегодня уже было маркетинговое
    // сообщение сверх потолка, не пишем (core/marketing/cap).
    const cap = await loadMarketingCap(ctx);
    const now = new Date();
    return picked
      .filter((u) => marketingAllowed(stateFromJson(u.state), cap, now))
      .map((u) => u.id);
  }
  return reachable.map((u) => u.id);
}

async function blockedIds(ctx: TenantContext): Promise<Set<number>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db.from("blocked_users").select("telegram_id").order("telegram_id").range(from, to),
    "заблокированные покупатели",
  );
  return new Set(rows.map((r) => Number(r.telegram_id)));
}

/** Страны покупателей для фильтра аудитории: код → сколько человек. */
export async function audienceCountries(ctx: TenantContext): Promise<Record<string, number>> {
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("state")
        .eq("platform", "telegram")
        .order("user_key")
        .range(from, to),
    "страны покупателей",
  );
  const out: Record<string, number> = {};
  for (const u of users) {
    const code = String((u.state as { country_code?: string } | null)?.country_code ?? "")
      .trim()
      .toUpperCase();
    if (code) out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}
