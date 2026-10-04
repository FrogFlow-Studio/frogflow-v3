import { alertChannelStatus, sendOperatorAlert } from "@/app/operator/health-alerts.server";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { deliverToEach } from "@/core/notify/deliver";
import { adminRecipients } from "@/core/notify/recipients";
import { operatorAlertHtml, sellerReplyText } from "@/core/support/notice-text";
import { servedByV2 } from "@/core/tenant/directory";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Уведомления о сообщениях поддержки. «Один раз» — условная отметка до
 * отправки: `notified_at` ставится обновлением «пока пусто», и сообщение
 * шлёт только тот, кто отметку поставил. Повтор запроса, двойной клик и
 * два запуска одновременно уведомление не продублируют. Если отправка могла
 * дойти (обрыв, тайм-аут), второй раз её не шлём — отметка остаётся.
 * Работает под служебным ключом: отметка — дело платформы, а не магазина.
 */
export type NoticeResult =
  | "sent"
  /** Это сообщение уже уведомляли (или параллельный запуск опередил). */
  | "already"
  /** Оператору: канал оповещений не настроен. Продавцу: магазин не на v2 или в архиве. */
  | "skipped"
  /** Продавцу некуда слать: нет бота или Telegram-id для уведомлений. */
  | "no_telegram"
  | "failed";

/** Ставит отметку; true — отметку поставили мы и отправлять нам. */
export async function claimNotice(messageId: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("platform_messages")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("notified_at", null)
    .select("id");
  if (error) throw serverFailure(`Поддержка: отметка уведомления не записана: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Продавец написал — оператору в Telegram (канал оповещений из «Настроек» оператора). */
export async function notifyOperator(
  botId: string,
  shop: string,
  messageId: string,
  body: string,
): Promise<NoticeResult> {
  // Канала нет — отметку не тратим: настроят позже, следующее сообщение дойдёт.
  if (!(await alertChannelStatus()).configured) return "skipped";
  if (!(await claimNotice(messageId))) return "already";
  const url = `${env().APP_URL.replace(/\/$/, "")}/operator/support?bot=${botId}`;
  const r = await sendOperatorAlert(operatorAlertHtml(shop, body, url));
  return r.ok ? "sent" : "failed";
}

/** Оператор ответил — продавцу в Telegram его магазина, на языке его админки. */
export async function notifySeller(
  botId: string,
  messageId: string,
  body: string,
): Promise<NoticeResult> {
  const tenant = await requireTenant({ by: "id", value: botId });
  if (tenant.archived || !servedByV2(tenant)) return "skipped";
  const ctx = tenantContext(tenant);
  const ids = tenant.telegramTokenEnc ? await adminRecipients(ctx) : [];
  if (ids.length === 0) return "no_telegram";
  if (!(await claimNotice(messageId))) return "already";
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const { telegramApi } = await import("@/channels/telegram/api");
  const text = sellerReplyText(
    await sellerLocale(ctx),
    body,
    `${ctx.appUrl.replace(/\/$/, "")}/admin/support`,
  );
  const api = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const report = await deliverToEach(ids, (id) => api.call("sendMessage", { chat_id: id, text }));
  return report.ok ? "sent" : "failed";
}
