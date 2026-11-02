import { telegramApi } from "@/channels/telegram/api";
import { escapeHtml } from "@/channels/telegram/copy";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { isLocale } from "@/core/i18n/locale";
import { sellerIds } from "@/core/notify/recipients";
import { getSettings } from "@/core/settings/settings";
import { tenantContext, tenantDirectory } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { soleZernioAccount } from "@/v4/channels/senders.server";
import { postgrestV4Db, type RpcClient, type V4Db } from "@/v4/core/db";
import { runV4Cron, type V4CronDeps, type V4CronJob, type V4Shop } from "@/v4/jobs/cron.server";
import type { SendOutcome } from "@/v4/core/cases/cases";

/**
 * Крон v4 поверх инфраструктуры v3: справочник арендаторов, токены ботов,
 * Zernio, чат оператора. Обслуживает только магазины с served_by = "v4";
 * таких пока нет, и крон не стоит в расписании — включается в день переезда.
 */

const SCHEMA_NOT_EXPOSED = /schema must be one of|PGRST106/i;

/** Магазин обслуживает v4 (v3 его уже не трогает: servedByV2 ждёт "v2"). */
export function servedByV4(t: Pick<Tenant, "settings">): boolean {
  return (t.settings as { served_by?: string }).served_by === "v4";
}

async function shopOf(t: Tenant): Promise<V4Shop> {
  const ctx = tenantContext(t);
  const st = await getSettings(ctx, ["admin_chat_id", "admin_locale"]);
  let telegram: V4Shop["telegram"] = null;
  try {
    telegram = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  } catch {
    telegram = null; // Telegram-бот не подключён — пишем только в Zernio.
  }
  const locale = isLocale(st.admin_locale) ? st.admin_locale : (t.settings.default_locale ?? "ru");
  return {
    botId: t.id,
    telegram,
    zernio: {
      instagram: soleZernioAccount(t.settings.zernio, "instagram"),
      whatsapp: soleZernioAccount(t.settings.zernio, "whatsapp"),
    },
    sellerChatIds: sellerIds(st.admin_chat_id, t.ownerTelegramId),
    sellerLang: locale,
  };
}

async function operatorSend(text: string): Promise<SendOutcome> {
  const { sendOperatorAlert } = await import("@/app/operator/health-alerts.server");
  const r = await sendOperatorAlert(escapeHtml(text));
  if (r.ok) return "sent";
  return r.reason === "failed" && r.maybeSent ? "unknown" : "failed";
}

export async function runV4CronJob(
  job: V4CronJob,
  over: Partial<V4CronDeps> & { tenants?: Tenant[] } = {},
): Promise<Record<string, unknown>> {
  const tenants = (over.tenants ?? (await tenantDirectory(true))).filter(servedByV4);
  const db: V4Db = over.db ?? postgrestV4Db(serviceDb() as unknown as RpcClient);
  try {
    return await runV4Cron(job, {
      db,
      botIds: tenants.map((t) => t.id),
      shops: () => Promise.all(tenants.map(shopOf)),
      appUrl: env().APP_URL,
      operator: operatorSend,
      ...over,
    });
  } catch (e) {
    // Схема v4 ещё не открыта в API — переезда не было, делать нечего.
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message))
      return { shops: tenants.length, skipped: "schema_not_exposed" };
    throw e;
  }
}
