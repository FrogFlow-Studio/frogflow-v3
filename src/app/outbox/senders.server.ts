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
  const { loadCrm, postPinned, safeWebhookUrl, signBody } = await import("@/core/crm/webhook");
  if (!safeWebhookUrl(url))
    return { ok: false, error: "адрес вебхука запрещён (не https или внутренний)" };
  const cfg = await loadCrm(ctx);
  let event = "order";
  try {
    event = String((JSON.parse(body) as { event?: string }).event ?? "order");
  } catch {
    /* тело — как есть */
  }
  // Адрес имени проверяется и закрепляется при соединении (pinnedLookup):
  // подмена DNS после проверки не уведёт запрос во внутреннюю сеть.
  const r = await postPinned(
    url,
    {
      "content-type": "application/json",
      "x-frogflow-event": event,
      ...(cfg?.secret ? { "x-frogflow-signature": signBody(body, cfg.secret) } : {}),
    },
    body,
    10_000,
  );
  if (!r.ok) return r;
  // Google Apps Script отвечает 302 на успешный POST — это успех.
  if ((r.status >= 200 && r.status < 300) || r.status === 302) return { ok: true };
  return { ok: false, error: `HTTP ${r.status}` };
}
