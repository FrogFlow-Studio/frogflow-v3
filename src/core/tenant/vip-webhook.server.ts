import { env } from "@/config/env";
import { telegramApi } from "@/channels/telegram/api";
import { telegramWebhookSecret } from "@/channels/telegram/secret";
import { tenantContext, patchTenantSettings } from "./resolve.server";
import type { Tenant } from "./types";
import type { WebhookState } from "./telegram-webhook.server";

export function vipWebhookUrl(appUrl: string, botId: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/telegram/${botId}/vip`;
}

/** Секрет вебхука VIP-бота — свой, чтобы обновления двух ботов не смешивались. */
export function vipWebhookSecret(botId: string, platformSecret: string): string {
  return telegramWebhookSecret(`${botId}:vip`, platformSecret);
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
  const info = await api.call<{ url?: string; pending_update_count?: number }>("getWebhookInfo");
  const current = info.result?.url ?? null;
  const pending = info.result?.pending_update_count ?? 0;
  if (!force && current === wantUrl) return { ok: true, url: current, pending };
  const set = await api.call("setWebhook", {
    url: wantUrl,
    secret_token: vipWebhookSecret(tenant.id, WEBHOOK_SECRET),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!set.ok) return { ok: false, url: current, pending, error: set.description };
  await patchTenantSettings(tenant.id, { vip: { webhook_ok: true } });
  return { ok: true, url: wantUrl, pending };
}
