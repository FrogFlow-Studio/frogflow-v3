import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import { sellerLocaleSafe } from "@/core/ai/seller-text";
import { rateStaleNotice } from "../messages";

/**
 * Покупатель просит рубли, а свежего курса нет (rate.server getFreshRate —
 * null): продавцу — одно предупреждение в сутки. Отметка — дата по поясу
 * магазина в app_settings; ставит её условная запись (updateSettingAtomic,
 * сравнение с прежним коротким значением), и только выигравший шлёт: два
 * сообщения покупателей одновременно дают одно предупреждение.
 */
export const RATE_STALE_NOTICE_KEY = "consultant_rate_stale_noticed";

/** «ГГГГ-ММ-ДД» по поясу магазина. */
export function localDay(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** true — предупреждение поставлено в очередь этим вызовом. Сбой не мешает ответу покупателю. */
export async function noticeStaleRate(ctx: TenantContext, now = new Date()): Promise<boolean> {
  try {
    const day = localDay(now, ctx.timezone);
    const claimed = await updateSettingAtomic(ctx, RATE_STALE_NOTICE_KEY, (raw) =>
      raw?.trim() === day ? null : day,
    );
    if (claimed !== "written") return false;
    const text = rateStaleNotice(await sellerLocaleSafe(ctx));
    const { adminRecipients } = await import("@/core/notify/recipients");
    const { enqueueOutbox } = await import("@/core/outbox/outbox");
    for (const chatId of await adminRecipients(ctx))
      await enqueueOutbox(
        ctx,
        { kind: "admin_notice", target: { channel: "telegram", chatId }, text, audience: "admin" },
        null,
      );
    return true;
  } catch (e) {
    console.error(`[rate:${ctx.tenant.id}] предупреждение о курсе не поставлено: ${String(e)}`);
    return false;
  }
}
