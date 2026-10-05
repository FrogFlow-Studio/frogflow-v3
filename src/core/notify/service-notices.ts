import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";

/**
 * Служебные уведомления продавцу из Instagram и WhatsApp, которые можно
 * выключить: «фото, не чек» и «бот на паузе: вы ответили сами». По умолчанию
 * включены, как были; выключает продавец в настройках (app_settings, значение
 * "false"). Сбой чтения настройки — «включено»: лучше лишнее уведомление, чем
 * пропущенное. Матрица «событие → канал» (core/notify/prefs) от этого не зависит:
 * она платная и у этих двух видов не было своей строки.
 */
export const SERVICE_NOTICE_KEYS = {
  photoNotReceipt: "notify_photo_not_receipt",
  botPause: "notify_bot_pause",
} as const;

export async function serviceNoticeEnabled(
  ctx: TenantContext,
  which: keyof typeof SERVICE_NOTICE_KEYS,
): Promise<boolean> {
  return (await getSetting(ctx, SERVICE_NOTICE_KEYS[which])) !== "false";
}
