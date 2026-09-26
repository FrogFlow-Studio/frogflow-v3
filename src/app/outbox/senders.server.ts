import { processOutbox, type OutboxSender, type ProcessResult } from "@/core/outbox/outbox";
import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { telegramOutboxSender } from "@/channels/telegram/outbox";
import { zernioOutboxSender } from "@/channels/zernio/outbox.server";

/**
 * Отправитель очереди: по каналу адресата — Telegram или Zernio; повтор
 * выдачи заказа — то же действие «подтвердить и выдать», что у продавца в
 * админке: выдача продолжается с невыданных позиций, уже выданный заказ —
 * успех.
 */
export function outboxSender(): OutboxSender {
  const zernio = zernioOutboxSender();
  return async (ctx, msg) => {
    if (msg.kind === "deliver_order") {
      if (!msg.orderId) return { ok: false, error: "нет номера заказа" };
      const { runOrderAction } = await import("@/app/admin/admin.server");
      const r = await runOrderAction(ctx, msg.orderId, "confirm", "outbox");
      return r.ok ? { ok: true } : { ok: false, error: r.message };
    }
    switch (msg.target.channel) {
      case "telegram":
        return telegramOutboxSender(ctx, msg);
      case "zernio":
        return zernio(ctx, msg);
      case "webhook":
        return postWebhook(ctx, msg.target.url, msg.text ?? "{}");
      default:
        return { ok: false, error: "неизвестный канал" };
    }
  };
}

/** Крон (раз в минуту, вместе с рассылками): повторы исходящих одного клиента. */
export async function runOutbox(tenant: Tenant): Promise<ProcessResult | { skipped: string }> {
  return processOutbox(tenantContext(tenant), outboxSender());
}

/** POST на вебхук продавца с подписью; адрес перепроверяется перед каждой отправкой. */
export async function postWebhook(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  url: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { loadCrm, safeWebhookUrl, signBody } = await import("@/core/crm/webhook");
  if (!safeWebhookUrl(url))
    return { ok: false, error: "адрес вебхука запрещён (не https или внутренний)" };
  const cfg = await loadCrm(ctx);
  let event = "order";
  try {
    event = String((JSON.parse(body) as { event?: string }).event ?? "order");
  } catch {
    /* тело — как есть */
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-frogflow-event": event,
        ...(cfg?.secret ? { "x-frogflow-signature": signBody(body, cfg.secret) } : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    // Google Apps Script отвечает 302 на успешный POST — это успех.
    if (r.ok || r.status === 302) return { ok: true };
    return { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
