/**
 * Фоновые задачи канала Zernio: WhatsApp-рассылка шаблонами Meta. Крон
 * `broadcast` обходит всех клиентов v2 и зовёт пакет по одному арендатору;
 * очередь, статусы и подсчёт — в ядре (core/broadcasts), здесь только
 * отправка через Zernio.
 */
import type { Tenant } from "@/core/tenant/types";
import { tenantContext } from "@/core/tenant/resolve.server";
import {
  processBroadcastBatch,
  type BatchResult,
  type BroadcastSender,
} from "@/core/broadcasts/broadcasts";
import { startWhatsAppConversation, zernioConfigured } from "./api.server";

export type WhatsAppStarter = typeof startWhatsAppConversation;

/**
 * Отправитель одного сообщения WhatsApp-рассылки: первое сообщение
 * покупателю вне 24-часового окна — только одобренным шаблоном. Ошибку
 * бросаем наружу: общий обработчик пакета запишет её по получателю, а
 * коды Meta «номер не в WhatsApp» посчитает как «заблокировали».
 */
export function whatsAppBroadcastSender(
  start: WhatsAppStarter = startWhatsAppConversation,
): BroadcastSender {
  return async (recipient, _content, broadcast) => {
    if (!recipient.phone) throw new Error("У получателя не сохранён номер WhatsApp");
    if (!broadcast.account_id || !broadcast.template_name)
      throw new Error("У рассылки не задан аккаунт или шаблон WhatsApp");
    const params = Array.isArray(broadcast.template_params)
      ? broadcast.template_params.map((p) => String(p ?? ""))
      : [];
    const r = await start({
      accountId: broadcast.account_id,
      phone: recipient.phone,
      templateName: broadcast.template_name,
      templateLanguage: broadcast.template_language ?? undefined,
      templateParams: params,
    });
    if (!r.ok) throw new Error(r.error || "Zernio не принял отправку");
  };
}

export async function runWhatsAppBroadcastBatch(
  tenant: Tenant,
  start?: WhatsAppStarter,
): Promise<BatchResult | { skipped: string }> {
  if (!tenant.modules.wa_broadcasts) return { skipped: "module off" };
  if (!start && !zernioConfigured()) return { skipped: "no zernio" };
  return processBroadcastBatch(tenantContext(tenant), whatsAppBroadcastSender(start), "whatsapp");
}
