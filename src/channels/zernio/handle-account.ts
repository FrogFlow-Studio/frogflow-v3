import type { TenantContext } from "@/core/tenant/resolve.server";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";

/**
 * `account.disconnected`: токен Instagram/WhatsApp истёк или отозван. Без
 * этого бот молча перестаёт отвечать, и продавец узнаёт от расстроенного
 * покупателя. Уведомляем продавца в Telegram (не чаще раза в 6 часов по
 * одному аккаунту) и помечаем аккаунт в снимке настроек — карточка в
 * админке покажет «нужно переподключить».
 */
const KEY = "zernio_disconnect_notified";
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type AccountDisconnectedPayload = {
  account?: {
    accountId?: string;
    id?: string;
    _id?: string;
    username?: string;
    name?: string;
    platform?: string;
  };
};

export async function handleAccountDisconnected(
  ctx: TenantContext,
  payload: AccountDisconnectedPayload,
): Promise<{ notified: boolean; note: string }> {
  const account = payload.account ?? {};
  const accountId = String(account.accountId || account.id || account._id || "");
  const label = account.username ? `@${account.username}` : account.name || accountId || "аккаунт";
  const channel = account.platform === "whatsapp" ? "WhatsApp" : "Instagram";

  const snapshot = ctx.tenant.settings.zernio?.accounts ?? [];
  if (accountId && snapshot.some((a) => a.id === accountId && !a.expired)) {
    await patchTenantSettings(ctx.tenant.id, {
      zernio: { accounts: snapshot.map((a) => (a.id === accountId ? { ...a, expired: true } : a)) },
    });
  }

  let last: { accountId?: string; at?: string } = {};
  try {
    last = JSON.parse((await getSetting(ctx, KEY)) || "{}") as typeof last;
  } catch {
    /* битое значение — уведомляем как обычно */
  }
  const cooled =
    last.accountId === accountId && last.at && Date.now() - Date.parse(last.at) < COOLDOWN_MS;
  if (cooled) return { notified: false, note: "уже уведомляли недавно" };

  await setSetting(ctx, KEY, JSON.stringify({ accountId, at: new Date().toISOString() }));
  const sent = await notifyAdminsHtml(
    ctx,
    `🔌 <b>${channel}-аккаунт отключился</b>\n\n` +
      `${escapeHtml(label)} отвязался — бот перестал видеть сообщения и отвечать.\n\n` +
      "Откройте «Оплата и настройки» → «Instagram и WhatsApp» и подключите аккаунт заново.",
  );
  return {
    notified: sent > 0,
    note: sent > 0 ? `продавец уведомлён (${label})` : "некому уведомить",
  };
}
