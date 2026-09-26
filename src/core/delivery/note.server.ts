import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";
import { DELIVERY_NOTE_KEY, withSellerNote } from "./note";

/**
 * Текст «заказ выдан» для канала заказа. В Telegram приписки нет, как в v1:
 * там выдача — файлы в чате с кнопками бота, а приписка писалась для Direct
 * и WhatsApp, где материалы приходят ссылками.
 */
export async function deliveredMessage(
  ctx: TenantContext,
  platform: string,
  deliveredHtml: string,
): Promise<string> {
  if (platform === "telegram") return deliveredHtml;
  const s = await getSettings(ctx, [DELIVERY_NOTE_KEY]);
  return withSellerNote(deliveredHtml, s[DELIVERY_NOTE_KEY]);
}
