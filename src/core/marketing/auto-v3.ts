import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";

/**
 * Новые автосообщения покупателям, которых не было в v2: просьба об оценке
 * после выдачи, «акция кончается завтра», напоминание о корзине в Instagram и
 * WhatsApp. Выключены, пока продавец сам не включит их в настройках
 * (app_settings `auto_messages_v3` = "true"): клиентам, уже работающим на
 * платформе, ничего нового само не уходит.
 */
export const AUTO_V3_KEY = "auto_messages_v3";

export async function autoMessagesV3(ctx: TenantContext): Promise<boolean> {
  return (await getSetting(ctx, AUTO_V3_KEY)) === "true";
}
