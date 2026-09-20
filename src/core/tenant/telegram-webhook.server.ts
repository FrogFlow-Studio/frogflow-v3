import { env } from "@/config/env";
import { telegramApi } from "@/channels/telegram/api";
import { telegramWebhookSecret, telegramWebhookUrl } from "@/channels/telegram/secret";
import { tenantContext, patchTenantSettings } from "./resolve.server";
import type { Tenant } from "./types";

export type WebhookState = { ok: boolean; url: string | null; pending: number; error?: string };

/**
 * Поставить вебхук бота на этот деплой. Только для клиентов, которых
 * обслуживает v2 (settings.served_by = "v2"): пока клиент на v1, его
 * вебхук смотрит на деплой v1, и трогать его нельзя — это и есть
 * переключатель миграции по одному клиенту.
 */
export async function ensureTelegramWebhook(tenant: Tenant, force = false): Promise<WebhookState> {
  if (tenant.settings.served_by !== "v2" || !tenant.telegramTokenEnc) {
    return { ok: false, url: null, pending: 0, error: "клиент не на v2 или без токена" };
  }
  const { APP_URL, WEBHOOK_SECRET, TELEGRAM_API_BASE } = env();
  const api = telegramApi(tenantContext(tenant).secrets.telegramToken(), TELEGRAM_API_BASE);
  const wantUrl = telegramWebhookUrl(APP_URL, tenant.id);

  const info = await api.call<{ url?: string; pending_update_count?: number }>("getWebhookInfo");
  const current = info.result?.url ?? null;
  const pending = info.result?.pending_update_count ?? 0;
  if (!force && current === wantUrl) return { ok: true, url: current, pending };

  const set = await api.call("setWebhook", {
    url: wantUrl,
    secret_token: telegramWebhookSecret(tenant.id, WEBHOOK_SECRET),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!set.ok) return { ok: false, url: current, pending, error: set.description };

  await patchTenantSettings(tenant.id, { telegram: { webhook_ok: true } });
  return { ok: true, url: wantUrl, pending };
}
