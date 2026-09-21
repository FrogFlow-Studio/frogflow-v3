import type { TenantContext } from "@/core/tenant/resolve.server";
import { isBlocked, upsertCustomer, type Customer } from "@/core/customers/customers";
import { escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { liveTransport, type ZernioTransport } from "./api.server";
import { findManagerMessage } from "./manager-guard";
import { messageAsText, parseZernioMessage, type ZernioWebhookMessagePayload } from "./message";
import { PLATFORM_LABEL } from "./platform";

/**
 * Входящее из Instagram Direct или WhatsApp. Адаптер разбирает событие,
 * находит покупателя, пишет реплику в «Чат» и отдаёт текст ядру: если продавец
 * подключился к диалогу в панели — бот молчит; иначе отвечает ИИ-консультант.
 * Перед ответом — проверка, не отвечает ли менеджер из приложения (хвост
 * переписки в Zernio). Магазин в Direct (каталог, корзина) — следующий шаг
 * фазы 4; пока без консультанта сообщение только попадает в «Чат».
 */
export type HandleResult = {
  status: "processed" | "ignored" | "failed";
  note?: string;
};

const ignored = (note: string): HandleResult => ({ status: "ignored", note });
const processed = (note?: string): HandleResult => ({ status: "processed", note });

type ConsultantMemory = {
  recent?: Array<{ role: string; text: string }>;
  last_reply_at?: string;
};

function consultantMemory(customer: Customer): ConsultantMemory {
  const c = customer.state.consultant;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as ConsultantMemory) : {};
}

export async function handleZernioMessage(
  ctx: TenantContext,
  payload: ZernioWebhookMessagePayload,
  transport: ZernioTransport = liveTransport,
): Promise<HandleResult> {
  const m = parseZernioMessage(payload);
  if (m.outgoing) return ignored("исходящее сообщение");
  if (!m.conversationId || !m.accountId) return ignored("нет conversationId или accountId");
  if (!ctx.tenant.modules[m.platform])
    return ignored(`модуль «${PLATFORM_LABEL[m.platform]}» у клиента выключен`);

  let customer = await upsertCustomer(ctx, m.platform, m.senderId, {
    username: m.senderUsername || null,
    firstName: m.senderName,
    zernioConversationId: m.conversationId,
    zernioAccountId: m.accountId,
    contactPhone: m.senderPhone || null,
    metadata: m.metadata,
  });
  if (await isBlocked(ctx, customer.telegramId)) return ignored("покупатель заблокирован");

  const text = messageAsText(m);
  if (!text) return ignored("пустое сообщение");

  if (ctx.tenant.modules.manager_chat) {
    const { inboundIntercepted } = await import("@/core/chat/chat");
    if (await inboundIntercepted(ctx, customer.telegramId, text))
      return processed("менеджер ведёт диалог в панели");
  }

  // Магазин в переписке — отдельный модуль на канал; свободный вопрос
  // уходит дальше консультанту или продавцу.
  let customerNow = customer;
  const shopOn =
    m.platform === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
  if (shopOn) {
    const { handleShopMessage } = await import("./shop.server");
    const r = await handleShopMessage(ctx, customer, m, transport);
    customerNow = r.customer;
    if (r.outcome === "handled") return processed("магазин");
  }

  const consultant = await import("@/core/consultant/engine.server");
  if (!(await consultant.consultantEnabled(ctx))) {
    if (shopOn && m.text) await forwardedToSeller(ctx, customerNow, m, transport);
    return processed("консультант выключен — сообщение в «Чате»");
  }
  if (consultant.isPaused(customerNow)) return processed("консультант на паузе");
  customer = customerNow;

  const memory = consultantMemory(customer);
  let tail: Awaited<ReturnType<ZernioTransport["tail"]>> = [];
  try {
    tail = await transport.tail(m.accountId, m.conversationId);
  } catch (e) {
    // Переписку не прочитали — отвечаем как есть: молчание дороже одного лишнего ответа.
    console.warn(`[zernio] tail unavailable for ${m.conversationId}: ${String(e)}`);
  }
  const manager = findManagerMessage(tail, {
    lastBotReplyAt: memory.last_reply_at,
    ourReplies: (memory.recent ?? []).filter((t) => t.role === "assistant").map((t) => t.text),
  });
  if (manager) {
    await consultant.pauseConsultant(ctx, customer);
    return processed("менеджер отвечает из приложения — консультант на паузе 12 ч");
  }

  const r = await consultant.runConsultant(ctx, customer, text, { platform: m.platform });
  if (!r) return { status: "failed", note: "консультант не ответил (см. consultant_last_error)" };

  const sent = await transport.send(m.conversationId, m.accountId, r.reply, {
    platform: m.platform,
  });
  if (!sent.ok) return { status: "failed", note: sent.error };

  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: customer.telegramId,
      direction: "out",
      sender: "bot",
      text: r.reply,
    });
  }

  if (r.handoff) {
    if (ctx.tenant.modules.manager_chat) {
      const { connect } = await import("@/core/chat/chat");
      await connect(ctx, customer.telegramId).catch(() => {});
    }
    const who = customer.firstName || (customer.username ? `@${customer.username}` : m.senderId);
    const lines = [
      r.handoff.kind === "lead"
        ? `📝 <b>Заявка от ИИ-консультанта</b> (${escapeHtml(r.handoff.reason)})`
        : `🙋 <b>Клиент ждёт менеджера</b> (${escapeHtml(r.handoff.reason)})`,
      `${PLATFORM_LABEL[m.platform]} · 👤 ${escapeHtml(who)}${customer.username ? ` · @${escapeHtml(customer.username)}` : ""}`,
      r.handoff.customerName ? `Имя: ${escapeHtml(r.handoff.customerName)}` : "",
      r.handoff.customerContact ? `📞 ${escapeHtml(r.handoff.customerContact)}` : "",
      `📋 ${escapeHtml(r.handoff.summary)}`,
      "",
      `Ответьте в разделе «Чат» панели или прямо в ${PLATFORM_LABEL[m.platform]} — консультант в этом диалоге молчит 12 часов.`,
    ].filter((l) => l !== "");
    await notifyAdminsHtml(ctx, lines.join("\n")).catch(() => 0);
  }
  return processed(r.handoff ? `ответ + передача менеджеру (${r.handoff.reason})` : undefined);
}

/**
 * Магазин включён, консультанта нет, а покупатель задал вопрос: один раз
 * сказать, что продавец ответит здесь, и как заказать. Повтор в течение
 * часа подавляется — иначе на каждую реплику диалога прилетал бы один и
 * тот же ответ (v1: «Передал ваш вопрос продавцу» дважды подряд).
 */
async function forwardedToSeller(
  ctx: TenantContext,
  customer: Customer,
  m: ReturnType<typeof parseZernioMessage>,
  transport: ZernioTransport,
) {
  const direct = customer.state.direct;
  const mem = direct && typeof direct === "object" && !Array.isArray(direct) ? direct : {};
  const at = Date.parse(String(mem.forwarded_at ?? ""));
  if (Number.isFinite(at) && Date.now() - at < 3600_000) return;
  const text =
    "Передал ваш вопрос продавцу — он ответит здесь. Чтобы заказать самостоятельно, напишите номер товара или «каталог».";
  const r = await transport.send(m.conversationId!, m.accountId!, text, { platform: m.platform });
  if (!r.ok) return;
  const { setState } = await import("@/core/customers/customers");
  await setState(ctx, customer, {
    ...customer.state,
    direct: { ...mem, forwarded_at: new Date().toISOString() },
  });
  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: customer.telegramId,
      direction: "out",
      sender: "bot",
      text,
    });
  }
}
