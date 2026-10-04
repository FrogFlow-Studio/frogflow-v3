import type { TenantContext } from "@/core/tenant/resolve.server";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import { markChannelDown } from "./guard.server";

/**
 * `account.disconnected`: токен Instagram/WhatsApp истёк или отозван. Без
 * этого бот молча перестаёт отвечать, и продавец узнаёт от расстроенного
 * покупателя. Аккаунт помечается в снимке настроек (карточка в админке
 * покажет «нужно переподключить»), а продавцу в Telegram уходит одно
 * сообщение на отключение: его шлёт страж каналов (guard.server), и событие,
 * и сверка аккаунтов по крону сходятся в одну условную запись.
 */
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

  const snapshot = ctx.tenant.settings.zernio?.accounts ?? [];
  if (accountId && snapshot.some((a) => a.id === accountId && !a.expired)) {
    await patchTenantSettings(ctx.tenant.id, {
      zernio: { accounts: snapshot.map((a) => (a.id === accountId ? { ...a, expired: true } : a)) },
    });
  }

  const { notified } = await markChannelDown(
    ctx,
    account.platform === "whatsapp" ? "whatsapp" : "instagram",
    "token",
  );
  return {
    notified,
    note: notified ? `продавец уведомлён (${label})` : "уже уведомляли об этом отключении",
  };
}
