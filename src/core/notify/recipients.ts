import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, parseIdList } from "@/core/settings/settings";

/**
 * Продавцы магазина в Telegram: все id из app_settings.admin_chat_id плюс
 * bots.owner_telegram_id (его задаёт оператор в карточке клиента), без дублей.
 * В v1 две ветки читали разные списки, и второй телефон продавца молчал
 * (fix c8a5f84) — здесь список один.
 */
export function sellerIds(
  adminChatIds: string | null | undefined,
  ownerTelegramId: number | null | undefined,
): string[] {
  const ids = parseIdList(adminChatIds);
  if (ownerTelegramId) ids.push(String(ownerTelegramId));
  return Array.from(new Set(ids));
}

/** Кому уходят уведомления продавца. */
export async function adminRecipients(ctx: TenantContext): Promise<string[]> {
  return sellerIds(await getSetting(ctx, "admin_chat_id"), ctx.tenant.ownerTelegramId);
}

/**
 * Кто вправе нажимать «подтвердить»/«отклонить»: тот же список, что получает
 * уведомление с этими кнопками. Раньше сюда не входил владелец, и владелец
 * без записи в admin_chat_id получал заказ с кнопками, но видел ⛔.
 */
export async function shopAdminIds(ctx: TenantContext): Promise<string[]> {
  return adminRecipients(ctx);
}
