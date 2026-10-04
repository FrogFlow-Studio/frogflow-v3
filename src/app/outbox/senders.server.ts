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
        return postWebhook(ctx, msg.target.url, msg.text ?? "{}", {
          outboxId: (msg as { id?: string }).id,
        });
      default:
        return { ok: false, error: "неизвестный канал" };
    }
  };
}

/** Крон (раз в минуту, вместе с рассылками): повторы исходящих одного клиента. */
export async function runOutbox(tenant: Tenant): Promise<ProcessResult | { skipped: string }> {
  return processOutbox(tenantContext(tenant), outboxSender());
}

/** Итог отправки вебхука: код ответа виден продавцу; permanent — повторять самим нельзя. */
export type WebhookResult =
  { ok: true; status: number } | { ok: false; error: string; status?: number; permanent?: boolean };

/**
 * POST на вебхук продавца с подписью; адрес перепроверяется перед каждой
 * отправкой. Итог пишется в журнал доставки. Отправка, которая могла дойти
 * (таймаут, обрыв после соединения, 5xx), автоматически не повторяется
 * (`permanent`): дубль решает продавец кнопкой из журнала, а событие уходит
 * с тем же `event_id`, и CRM может отбросить повтор. Повторяются только
 * заведомо не ушедшие (соединения не было) и ответы 4xx.
 */
export async function postWebhook(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  url: string,
  body: string,
  meta: { outboxId?: string } = {},
): Promise<WebhookResult> {
  const { loadCrm, postPinned, safeWebhookUrl, signBody } = await import("@/core/crm/webhook");
  const { logEntryFor, recordCrmDelivery } = await import("@/core/crm/log");
  if (!safeWebhookUrl(url)) {
    await recordCrmDelivery(ctx, {
      ...logEntryFor(body, { ok: false, error: "blocked" }, meta),
      outcome: "blocked",
    });
    return {
      ok: false,
      error: "адрес вебхука запрещён (не https или внутренний)",
      permanent: true,
    };
  }
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
  await recordCrmDelivery(ctx, logEntryFor(body, r, meta));
  if (!r.ok) return { ...r, permanent: !r.notSent };
  // Google Apps Script отвечает 302 на успешный POST — это успех.
  if ((r.status >= 200 && r.status < 300) || r.status === 302)
    return { ok: true, status: r.status };
  return { ok: false, error: `HTTP ${r.status}`, status: r.status, permanent: r.status >= 500 };
}
