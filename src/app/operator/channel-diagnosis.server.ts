import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant } from "@/core/tenant/resolve.server";
import { tenantContext } from "@/core/tenant/resolve.server";
import { telegramApi } from "@/channels/telegram/api";
import { telegramWebhookUrl } from "@/channels/telegram/secret";
import { TELEGRAM_UPDATE_EVENT } from "@/channels/telegram/dedupe";
import { listAccounts, readWebhookSettings, zernioConfigured } from "@/channels/zernio/api.server";
import { zernioFailureOf } from "@/channels/zernio/errors";
import { failedReason } from "@/channels/zernio/message-failed.server";
import { ownWebhook } from "@/channels/zernio/webhook-fit";
import { serverFailure } from "@/lib/server-failure";
import {
  diagnoseTelegram,
  diagnoseZernio,
  type DiagChannel,
  type Diagnosis,
  type TelegramFacts,
  type ZernioFacts,
} from "./channel-diagnosis";
import { zernioLastEvents } from "./operator.server";

/** Последняя строка журнала клиента с таким типом события; null — нет, исключение — сбой чтения. */
async function latestLog(
  botId: string,
  eventType: string,
): Promise<{ created_at: string; payload: unknown } | null> {
  const { data, error } = await serviceDb()
    .from("zernio_logs")
    .select("created_at, payload")
    .eq("bot_id", botId)
    .eq("event_type", eventType)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw serverFailure(`[operator] журнал событий не прочитан: ${error.message}`);
  return data?.[0] ?? null;
}

async function telegramFacts(botId: string): Promise<TelegramFacts> {
  const t = await requireTenant({ by: "id", value: botId });
  const base: TelegramFacts = {
    servedBy: t.settings.served_by ?? null,
    tokenSet: Boolean(t.telegramTokenEnc),
    me: null,
    webhook: null,
    lastEventAt: undefined,
    now: new Date(),
  };
  if (!t.telegramTokenEnc) return { ...base, lastEventAt: null };
  const api = telegramApi(tenantContext(t).secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const me = await api.call<{ username?: string }>("getMe");
  base.me = me.ok
    ? { ok: true, username: me.result?.username ?? null }
    : { ok: false, code: me.error_code ?? null };
  if (me.ok && base.servedBy === "v2") {
    const expected = telegramWebhookUrl(env().APP_URL, t.id);
    const info = await api.call<{
      url?: string;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
    }>("getWebhookInfo");
    base.webhook = info.ok
      ? {
          url: info.result?.url || null,
          expected,
          pending: info.result?.pending_update_count ?? 0,
          lastErrorAt: info.result?.last_error_date
            ? new Date(info.result.last_error_date * 1000).toISOString()
            : null,
          lastErrorMessage: info.result?.last_error_message ?? null,
        }
      : { error: info.description ?? "нет ответа" };
  }
  try {
    base.lastEventAt = (await latestLog(botId, TELEGRAM_UPDATE_EVENT))?.created_at ?? null;
  } catch (e) {
    console.warn("[operator] последнее событие Telegram не прочитано:", e);
  }
  return base;
}

async function zernioFacts(botId: string, channel: "instagram" | "whatsapp"): Promise<ZernioFacts> {
  const t = await requireTenant({ by: "id", value: botId });
  const z = t.settings.zernio;
  const profileId = z?.profile_id?.trim() || null;
  const f: ZernioFacts = {
    servedBy: t.settings.served_by ?? null,
    keySet: zernioConfigured(),
    profileId,
    accounts: (z?.accounts ?? [])
      .filter((a) => a.platform === channel)
      .map((a) => ({ id: a.id, username: a.username ?? null, expired: Boolean(a.expired) })),
    live: null,
    webhook: null,
    lastEventAt: undefined,
    lastFailed: undefined,
    now: new Date(),
  };
  if (!f.keySet || !profileId) return f;
  try {
    const accounts = await listAccounts(profileId);
    f.live = {
      ok: true,
      accounts: accounts.map((a) => ({
        id: a._id,
        platform: a.platform,
        expired: Boolean(a.isExpired),
      })),
    };
  } catch (e) {
    f.live = {
      ok: false,
      failure: zernioFailureOf(e),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (f.servedBy === "v2") {
    try {
      const url = `${env().APP_URL.replace(/\/$/, "")}/api/zernio/webhook`;
      const own = ownWebhook(await readWebhookSettings(), url);
      f.webhook = {
        own: own
          ? {
              active: own.isActive ?? own.active ?? true,
              profileIds: own.profileIds ?? [],
              events: own.events ?? [],
            }
          : null,
      };
    } catch (e) {
      f.webhook = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  try {
    const events = await zernioLastEvents(botId);
    const own = f.accounts.map((a) => events.get(a.id)).filter((x): x is string => Boolean(x));
    f.lastEventAt = own.sort().at(-1) ?? events.get("*") ?? null;
  } catch (e) {
    console.warn("[operator] события Zernio не прочитаны:", e);
  }
  if (channel === "whatsapp") {
    try {
      const row = await latestLog(botId, "message.failed");
      const payload = row?.payload as { error?: { code?: number | string } | null } | null;
      f.lastFailed = row
        ? { at: row.created_at, reason: failedReason(payload?.error ?? null) }
        : null;
    } catch (e) {
      console.warn("[operator] отказы доставки не прочитаны:", e);
    }
  }
  return f;
}

/** Диагностика канала клиента: только чтение у Telegram, Zernio и в журнале. */
export async function diagnoseChannel(botId: string, channel: DiagChannel): Promise<Diagnosis> {
  if (channel === "telegram") return diagnoseTelegram(await telegramFacts(botId));
  return diagnoseZernio(channel, await zernioFacts(botId, channel));
}
