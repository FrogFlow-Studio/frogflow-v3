import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, trySetSetting } from "@/core/settings/settings";
import {
  ADMIN_NOTIFY_DISMISS_DELAY_MS,
  ORDER_NOTIFY_KEY_PREFIX,
  adminNotifySettingKey,
  isAdminNotifyDue,
  mergeAdminNotifyRefs,
  parseAdminNotifyPack,
  type AdminNotifyPack,
  type AdminNotifyTgRef,
} from "@/core/notify/order-pack";
import type { TelegramApi } from "./api";

/**
 * Жизнь уведомления продавцу о заказе в Telegram (как в v1): сообщения
 * запоминаются при отправке, после решения по заказу кнопки снимаются сразу,
 * а через 5 минут минутный крон удаляет пачку из чатов. Сбой здесь не мешает
 * заказу: худшее — уведомление останется в чате.
 */
async function loadPack(ctx: TenantContext, orderId: number): Promise<AdminNotifyPack> {
  return parseAdminNotifyPack(await getSetting(ctx, adminNotifySettingKey(orderId)));
}

async function savePack(ctx: TenantContext, orderId: number, pack: AdminNotifyPack) {
  const key = adminNotifySettingKey(orderId);
  if (!pack.refs.length && !pack.deleteAfter) {
    await ctx.db.from("app_settings").delete().eq("key", key);
    return;
  }
  await trySetSetting(ctx, key, JSON.stringify(pack));
}

export async function rememberOrderNotify(
  ctx: TenantContext,
  orderId: number,
  refs: AdminNotifyTgRef[],
): Promise<void> {
  if (!refs.length) return;
  const pack = await loadPack(ctx, orderId);
  pack.refs = mergeAdminNotifyRefs(pack.refs, refs);
  await savePack(ctx, orderId, pack);
}

/** После «подтвердить»/«отклонить»: кнопки — сразу, сами сообщения — через 5 минут. */
export async function scheduleOrderNotifyDismiss(
  ctx: TenantContext,
  api: TelegramApi,
  orderId: number,
  now = Date.now(),
): Promise<void> {
  try {
    const pack = await loadPack(ctx, orderId);
    if (!pack.refs.length) return;
    if (!pack.deleteAfter || !Number.isFinite(Date.parse(pack.deleteAfter)))
      pack.deleteAfter = new Date(now + ADMIN_NOTIFY_DISMISS_DELAY_MS).toISOString();
    const stripped = pack.refs.filter((r) => r.buttons);
    pack.refs = pack.refs.map(({ chat_id, message_id }) => ({ chat_id, message_id }));
    await savePack(ctx, orderId, pack);
    for (const r of stripped)
      await api.call("editMessageReplyMarkup", {
        chat_id: r.chat_id,
        message_id: r.message_id,
        reply_markup: { inline_keyboard: [] },
      });
  } catch (e) {
    console.warn(`[tg:${ctx.tenant.id}] уведомление о заказе #${orderId} не снято`, e);
  }
}

/** Минутный крон: удалить из чатов пачки, у которых вышел срок. Возвращает число пачек. */
export async function flushDueOrderNotify(
  ctx: TenantContext,
  api: TelegramApi,
  now = Date.now(),
): Promise<number> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${ORDER_NOTIFY_KEY_PREFIX}%`);
  if (error) throw new Error(error.message);
  let dismissed = 0;
  for (const row of data ?? []) {
    const pack = parseAdminNotifyPack(row.value);
    if (!isAdminNotifyDue(pack, now)) continue;
    // Сообщение старше 48 часов Telegram удалить не даст — это не повод держать пачку.
    for (const r of pack.refs)
      await api.call("deleteMessage", { chat_id: r.chat_id, message_id: r.message_id });
    await ctx.db.from("app_settings").delete().eq("key", row.key);
    dismissed += 1;
  }
  return dismissed;
}
