import type { TenantContext } from "@/core/tenant/resolve.server";
import { admitInbound, floodNoticeHtml } from "@/core/customers/inbound-rate";
import { escapeHtml } from "./copy";

type From = { id?: number; username?: string; first_name?: string };
type Update = {
  message?: {
    from?: From;
    chat?: { type?: string };
    text?: string;
    successful_payment?: unknown;
  };
  callback_query?: { from?: From };
};

/**
 * Лимит частоты входящих в Telegram-боте (core/customers/inbound-rate).
 * Считаются личные сообщения и нажатия кнопок покупателя; продавцы магазина
 * (admin_chat_id и владелец) лимиту не подчиняются. false — обновление не
 * обрабатываем. `notify` — уведомление продавцу (раз в час на покупателя).
 */
export async function telegramInboundAllowed(
  ctx: TenantContext,
  update: Update,
  notify: (html: string) => Promise<void>,
): Promise<boolean> {
  const msg = update.message;
  // Оплату и вход по ссылке (/start с параметром) не режем: их потеря дороже спама.
  if (msg?.successful_payment || /^\/start\s+\S/.test(msg?.text ?? "")) return true;
  const personal = msg?.chat?.type === "private" ? msg.from : undefined;
  const from = personal ?? update.callback_query?.from;
  if (!from?.id) return true;
  const verdict = await admitInbound(ctx, `tg_${from.id}`, () => isSeller(ctx, from.id!));
  if (verdict === "ok") return true;
  if (verdict === "limited_notify") {
    const who = from.username ? `@${from.username}` : from.first_name || String(from.id);
    await notify(floodNoticeHtml("Telegram", escapeHtml(who)));
  }
  return false;
}

/**
 * Продавец магазина (admin_chat_id или владелец). Список читается с проверкой
 * ошибки: при сбое базы считаем продавцом — пропустить лишнее сообщение
 * лучше, чем отрезать продавца от его бота.
 */
async function isSeller(ctx: TenantContext, id: number): Promise<boolean> {
  if (Number(ctx.tenant.ownerTelegramId) === id) return true;
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();
  if (error) return true;
  const { sellerIds } = await import("@/core/notify/recipients");
  return sellerIds(data?.value, ctx.tenant.ownerTelegramId).includes(String(id));
}
