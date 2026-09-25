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
      default:
        return { ok: false, error: "неизвестный канал" };
    }
  };
}

/** Крон (раз в минуту, вместе с рассылками): повторы исходящих одного клиента. */
export async function runOutbox(tenant: Tenant): Promise<ProcessResult | { skipped: string }> {
  return processOutbox(tenantContext(tenant), outboxSender());
}
