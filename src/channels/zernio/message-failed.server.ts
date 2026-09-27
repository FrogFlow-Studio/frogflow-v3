import type { TenantContext } from "@/core/tenant/resolve.server";
import { customerFromRow, type Customer } from "@/core/customers/customers";
import { escapeHtml } from "@/channels/telegram/copy";
import { classifyZernioFailure, type ZernioFailure } from "./errors";

/**
 * `message.failed`: WhatsApp принял отправку (Zernio ответил 200), а потом не
 * доставил — другого сигнала об этом нет (сверка, п. 11; у Instagram такого
 * события нет вовсе). Покупатель ищется по диалогу Zernio. В «Чате» появляется
 * пометка «не доставлено» с причиной; если не дошли материалы заказа (строка
 * «📁 <товар>», как их шлёт deliver.ts), продавцу уходит уведомление.
 * Заказ не трогаем: что делать дальше, решает продавец.
 */
export type MessageFailedPayload = {
  event: string;
  message?: { conversationId?: string; text?: string | null; platformMessageId?: string };
  conversation?: { id?: string };
  error?: { code?: number | string; title?: string; message?: string } | null;
};

/** Сколько дней назад искать заказ, чьи материалы не дошли. */
const ORDER_LOOKBACK_DAYS = 7;
const EXCERPT_LEN = 120;

/** Отказ из события — в поля классификатора #228: код Meta, статус «принято». */
export function failureOfEvent(error: MessageFailedPayload["error"]): ZernioFailure {
  const code = Number(error?.code);
  return { status: 200, ...(Number.isInteger(code) ? { platformCode: code } : {}) };
}

/** Причина словами продавца: по коду, а не по тексту Meta. */
export function failedReason(error: MessageFailedPayload["error"]): string {
  const kind = classifyZernioFailure(failureOfEvent(error));
  if (kind === "window_closed")
    return "прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только шаблоном";
  if (kind === "unreachable")
    return "номер покупателя не принимает сообщения WhatsApp (нет WhatsApp или приложение устарело)";
  if (kind === "rate_limited") return "WhatsApp ограничил частоту сообщений этому покупателю";
  const code = error?.code != null && String(error.code).trim() ? ` (код ${error.code})` : "";
  return `WhatsApp не доставил сообщение${code}`;
}

async function customerOfConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<Customer | null> {
  const { data } = await ctx.db
    .from("bot_users")
    .select("*")
    .eq("zernio_conversation_id", conversationId)
    .order("user_key", { ascending: true })
    .limit(1);
  const row = data?.[0];
  return row ? customerFromRow(row) : null;
}

/** Заказ покупателя с позицией «name» за последние дни — чьи материалы и не дошли. */
async function deliveredOrderWith(ctx: TenantContext, telegramId: number, name: string) {
  const since = new Date(Date.now() - ORDER_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: orders } = await ctx.db
    .from("orders")
    .select("id, display_no, order_no")
    .eq("telegram_id", telegramId)
    .eq("status", "delivered")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  if (!orders?.length) return null;
  const { data: items } = await ctx.db
    .from("order_items")
    .select("order_id, name_snapshot")
    .in(
      "order_id",
      orders.map((o) => o.id),
    )
    .eq("name_snapshot", name);
  const ids = new Set((items ?? []).map((i) => i.order_id));
  return orders.find((o) => ids.has(o.id)) ?? null;
}

export async function handleMessageFailed(
  ctx: TenantContext,
  payload: MessageFailedPayload,
): Promise<{ note: string }> {
  const conversationId = payload.message?.conversationId || payload.conversation?.id;
  if (!conversationId) return { note: "нет conversationId" };
  const customer = await customerOfConversation(ctx, conversationId);
  if (!customer) return { note: "покупатель не найден" };

  const reason = failedReason(payload.error);
  const text = (payload.message?.text ?? "").trim();
  const excerpt = text.length > EXCERPT_LEN ? `${text.slice(0, EXCERPT_LEN)}…` : text;
  const notes: string[] = [];

  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: customer.telegramId,
      direction: "out",
      sender: "bot",
      text: `⚠️ Не доставлено${excerpt ? `: «${excerpt}»` : ""}. Причина: ${reason}.`,
    });
    notes.push("пометка в «Чате»");
  }

  const material = /^📁\s*(.+)$/u.exec(text.split("\n")[0] ?? "")?.[1]?.trim();
  const order = material ? await deliveredOrderWith(ctx, customer.telegramId, material) : null;
  if (order) {
    const no = order.display_no ?? order.order_no;
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    await notifyAdminsHtml(
      ctx,
      `⚠️ Заказ #${no}: WhatsApp не доставил покупателю материалы «${escapeHtml(material!)}» — ${escapeHtml(reason)}. ` +
        `Материалы есть на странице заказа: отправьте покупателю ссылку на неё или свяжитесь с ним.`,
      { orderId: order.id, kind: "delivery_failure" },
    );
    notes.push(`продавцу про заказ #${no}`);
  }
  return { note: `не доставлено: ${reason}${notes.length ? ` · ${notes.join(", ")}` : ""}` };
}
