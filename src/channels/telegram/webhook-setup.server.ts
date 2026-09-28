import { env } from "@/config/env";
import { telegramApi } from "./api";
import { telegramWebhookSecret, telegramWebhookUrl } from "./secret";
import { tenantContext, patchTenantSettings } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { storefrontBase } from "@/core/tenant/custom-domain";
import { servedByV2 } from "@/core/tenant/directory";
import { botCommandsVersion, clearBotCommands, syncBotCommands } from "./commands";

/** Что бот получает от Telegram; pre_checkout_query — подтверждение оплаты Stars. */
export const ALLOWED_UPDATES = ["message", "callback_query", "pre_checkout_query"];

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

  const info = await api.call<{
    url?: string;
    pending_update_count?: number;
    allowed_updates?: string[];
  }>("getWebhookInfo");
  const current = info.result?.url ?? null;
  const pending = info.result?.pending_update_count ?? 0;
  // Новый тип обновлений (pre_checkout_query для Stars) — повод переставить вебхук.
  const have = new Set(info.result?.allowed_updates ?? ["message", "callback_query"]);
  const sameUpdates = ALLOWED_UPDATES.every((u) => have.has(u));
  if (!force && current === wantUrl && sameUpdates) {
    // Вебхук на месте, но меню команд старое (или его ещё не ставили).
    if (tenant.settings.telegram?.commands_v !== botCommandsVersion(tenant))
      await applyBotCommands(tenant, api);
    return { ok: true, url: current, pending };
  }

  const set = await api.call("setWebhook", {
    url: wantUrl,
    secret_token: telegramWebhookSecret(tenant.id, WEBHOOK_SECRET),
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: false,
  });
  if (!set.ok) return { ok: false, url: current, pending, error: set.description };

  await patchTenantSettings(tenant.id, { telegram: { webhook_ok: true } });
  await syncMenuButton(tenant, api).catch(() => {});
  await applyBotCommands(tenant, api);
  return { ok: true, url: wantUrl, pending };
}

/**
 * Меню команд (/catalog, /cart, /orders, /language, /stop) на языках
 * покупателей. Отпечаток набора — в settings.telegram.commands_v, чтобы
 * крон не звал Telegram каждый прогон. Сбой меню вебхук не отменяет:
 * отпечаток не пишем, крон попробует снова.
 */
async function applyBotCommands(
  tenant: Tenant,
  api: ReturnType<typeof telegramApi>,
): Promise<void> {
  try {
    await syncBotCommands(tenant, api);
    await patchTenantSettings(tenant.id, {
      telegram: { commands_v: botCommandsVersion(tenant) },
    });
  } catch (e) {
    console.warn(`[telegram-webhook:${tenant.id}] меню команд:`, e);
  }
}

/** Кнопка меню бота: «Магазин» (Mini App) при включённом модуле, иначе стандартная. */
export async function syncMenuButton(
  tenant: Tenant,
  api: ReturnType<typeof telegramApi>,
): Promise<void> {
  const { APP_URL } = env();
  const on = tenant.modules.telegram_mini_app && tenant.modules.shop;
  await api.call("setChatMenuButton", {
    menu_button: on
      ? {
          type: "web_app",
          text: "🛍 Магазин",
          web_app: { url: storefrontBase(tenant, APP_URL) },
        }
      : { type: "default" },
  });
}

/**
 * Адрес витрины сменился (свой домен): кнопка «Магазин» должна вести туда же.
 * Только для клиента v2 — бота клиента v1 не трогаем (CLAUDE.md, правило 6).
 */
export async function refreshMenuButton(tenant: Tenant): Promise<void> {
  if (!tenant.telegramTokenEnc || !servedByV2(tenant) || tenant.archived) return;
  const { TELEGRAM_API_BASE } = env();
  const api = telegramApi(tenantContext(tenant).secrets.telegramToken(), TELEGRAM_API_BASE);
  await syncMenuButton(tenant, api);
}

/**
 * Откат клиента на v1: кнопка меню бота смотрела на витрину v2 (/s/<slug>),
 * а v2 клиентов v1 на витрину не пускает. Возвращаем стандартную кнопку;
 * свою Mini App v1 поставит при следующей перезагрузке настроек. Вебхук не
 * трогаем: его забирает крон деплоя v1 (секрет подписи знает только он).
 */
export async function releaseTelegramToV1(tenant: Tenant): Promise<void> {
  if (!tenant.telegramTokenEnc) return;
  const { TELEGRAM_API_BASE } = env();
  const api = telegramApi(tenantContext(tenant).secrets.telegramToken(), TELEGRAM_API_BASE);
  await api.call("setChatMenuButton", { menu_button: { type: "default" } });
  await clearBotCommands(api);
  // Отпечаток сбрасываем: при возврате на v2 меню поставится заново.
  await patchTenantSettings(tenant.id, { telegram: { commands_v: "" } });
}
