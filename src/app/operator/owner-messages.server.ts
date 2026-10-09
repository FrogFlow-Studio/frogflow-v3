import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { telegramApi } from "@/channels/telegram/api";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { sellerLocaleSafe } from "@/core/ai/seller-text";
import { intlLocale } from "@/app/i18n/admin";
import { ownerTemplates, type OwnerTemplateKey } from "@/core/notify/owner-templates";
import { type DeliveryReport } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./client-log.server";
import { extras } from "./client-list.server";

/** Сообщения владельцу магазина. */

export async function notifyOwner(
  botId: string,
  text: string,
  template: OwnerTemplateKey | null = null,
): Promise<DeliveryReport> {
  const t = await requireTenant({ by: "id", value: botId });
  const ctx = tenantContext(t);
  const { adminRecipients } = await import("@/core/notify/recipients");
  const { deliverToEach } = await import("@/core/notify/deliver");
  const api = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const r = await deliverToEach(await adminRecipients(ctx), (id) =>
    api.call("sendMessage", { chat_id: id, text }),
  );
  // Полный текст в журнале (до 1000 знаков): оператор видит, что именно писал клиенту.
  await logEvent(botId, "message", {
    text: text.slice(0, 1000),
    template,
    delivered: r.delivered.length,
    failed: r.failed.length,
  });
  return r;
}

export type OwnerMessageDraft = {
  locale: Locale;
  templates: ReturnType<typeof ownerTemplates>;
};

/** Шаблоны сообщений владельцу на языке его админки (иначе языка магазина, иначе русский). */
export async function ownerMessageDraft(botId: string): Promise<OwnerMessageDraft> {
  const t = await requireTenant({ by: "id", value: botId });
  const locale = await sellerLocaleSafe(tenantContext(t));
  const ex = (await extras([botId])).get(botId);
  const until = ex?.subscription_expires_at ?? null;
  const paidUntil = until
    ? new Date(until).toLocaleDateString(intlLocale(locale), { timeZone: env().APP_TIMEZONE })
    : null;
  return { locale, templates: ownerTemplates(locale, { shop: t.name, paidUntil }) };
}

export type OwnerMessageLogItem = {
  id: string;
  at: string;
  text: string;
  template: string | null;
  delivered: number;
  failed: number;
};

/** Журнал сообщений владельцу: последние 30 из `bot_events` (kind = message). */
export async function listOwnerMessages(botId: string): Promise<OwnerMessageLogItem[]> {
  const { data, error } = await serviceDb()
    .from("bot_events")
    .select("id, at, payload")
    .eq("bot_id", botId)
    .eq("kind", "message")
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  if (error) throw serverFailure(`[operator] журнал сообщений не прочитан: ${error.message}`);
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      at: r.at,
      text: typeof p.text === "string" ? p.text : "",
      template: typeof p.template === "string" ? p.template : null,
      delivered: Number(p.delivered ?? 0),
      failed: Number(p.failed ?? 0),
    };
  });
}
