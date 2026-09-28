import { env } from "@/config/env";
import { telegramApi } from "./api";
import { telegramWebhookSecret } from "./secret";
import { tenantContext, patchTenantSettings } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { WebhookState } from "./webhook-setup.server";

export function vipWebhookUrl(appUrl: string, botId: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/telegram/${botId}/vip`;
}

/** Секрет вебхука VIP-бота — свой, чтобы обновления двух ботов не смешивались. */
export function vipWebhookSecret(botId: string, platformSecret: string): string {
  return telegramWebhookSecret(`${botId}:vip`, platformSecret);
}

/**
 * События VIP-бота. chat_member — входы в группу: по ним ловим вход по
 * пересланной ссылке подписки (core/vip/join-guard). Telegram шлёт его,
 * только если он явно указан в allowed_updates.
 */
export const VIP_ALLOWED_UPDATES = ["message", "callback_query", "chat_member"];

function sameUpdates(have: string[] | undefined): boolean {
  const a = [...(have ?? [])].sort();
  const b = [...VIP_ALLOWED_UPDATES].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Вебхук VIP-бота на этот деплой; только у клиентов на v2 с модулем vip и токеном. */
export async function ensureVipWebhook(tenant: Tenant, force = false): Promise<WebhookState> {
  if (tenant.settings.served_by !== "v2" || !tenant.modules.vip || !tenant.settings.vip?.token_enc)
    return {
      ok: false,
      url: null,
      pending: 0,
      error: "нет модуля vip, токена или клиент не на v2",
    };
  const { APP_URL, WEBHOOK_SECRET, TELEGRAM_API_BASE } = env();
  const api = telegramApi(tenantContext(tenant).secrets.vipToken(), TELEGRAM_API_BASE);
  const wantUrl = vipWebhookUrl(APP_URL, tenant.id);
  const info = await api.call<{
    url?: string;
    pending_update_count?: number;
    allowed_updates?: string[];
  }>("getWebhookInfo");
  const current = info.result?.url ?? null;
  const pending = info.result?.pending_update_count ?? 0;
  // Сверяем и адрес, и список событий: у вебхука, поставленного до защиты
  // группы, chat_member нет — его надо переставить.
  if (!force && current === wantUrl && sameUpdates(info.result?.allowed_updates))
    return { ok: true, url: current, pending };
  const set = await api.call("setWebhook", {
    url: wantUrl,
    secret_token: vipWebhookSecret(tenant.id, WEBHOOK_SECRET),
    allowed_updates: VIP_ALLOWED_UPDATES,
    drop_pending_updates: false,
  });
  if (!set.ok) return { ok: false, url: current, pending, error: set.description };
  await patchTenantSettings(tenant.id, { vip: { webhook_ok: true } });
  return { ok: true, url: wantUrl, pending };
}
