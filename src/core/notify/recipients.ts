import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, parseIdList } from "@/core/settings/settings";

/**
 * Кому уходят уведомления продавца: bots.owner_telegram_id плюс все id из
 * app_settings.admin_chat_id, без дублей. В v1 две ветки читали разные
 * списки, и второй телефон продавца молчал (fix c8a5f84) — здесь список один.
 */
export async function adminRecipients(ctx: TenantContext): Promise<string[]> {
  const ids = parseIdList(await getSetting(ctx, "admin_chat_id"));
  if (ctx.tenant.ownerTelegramId) ids.push(String(ctx.tenant.ownerTelegramId));
  return Array.from(new Set(ids));
}

/** Только admin_chat_id: кто вправе нажимать «подтвердить»/«отклонить». */
export async function shopAdminIds(ctx: TenantContext): Promise<string[]> {
  return parseIdList(await getSetting(ctx, "admin_chat_id"));
}
