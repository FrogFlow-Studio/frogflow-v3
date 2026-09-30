import type { TenantContext } from "@/core/tenant/resolve.server";
import { isBlocked, upsertCustomer, type Customer } from "@/core/customers/customers";
import { COPY, escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { liveTransport, type ZernioTransport } from "./api.server";
import { findManagerMessage } from "./manager-guard";
import { pauseHours, pauseNoticeRu } from "@/core/consultant/pause";
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
  resumed_at?: string;
  relayed?: string[];
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

  // Двухшаговая Comment-to-DM: покупатель написал первым после комментария —
  // отдаём обещанное второе сообщение с кнопками; «+»/«да» дальше не разбираем.
  if (m.platform === "instagram" && m.senderUsername && ctx.tenant.modules.instagram) {
    const { deliverPendingTwoStepDm, twoStepJustDelivered } = await import("./automations.server");
    const { isTwoStepAcknowledgement, isShopStartWord } =
      await import("@/core/instagram/comment-rules");
    const delivered = await deliverPendingTwoStepDm(ctx, {
      accountId: m.accountId,
      conversationId: m.conversationId,
      username: m.senderUsername,
    });
    // Второй быстрый «+» после уже отданного второго сообщения тоже не разбираем.
    // Только набранный ответ: нажатие кнопки второго сообщения и фото чека идут дальше.
    const typedOnly = !m.postbackPayload && m.attachments.length === 0 && !m.nativeOrder;
    const toShop = ctx.tenant.modules.dm_shop && isShopStartWord(m.text);
    if (
      !toShop &&
      isTwoStepAcknowledgement(m.text) &&
      (delivered ||
        (typedOnly &&
          (await twoStepJustDelivered(ctx, m.senderUsername, payload.message?.sentAt ?? null))))
    )
      return processed("второе сообщение по комментарию");
  }

  const text = messageAsText(m);
  if (!text) return ignored("пустое сообщение");

  let intercepted = false;
  if (ctx.tenant.modules.manager_chat) {
    const { inboundIntercepted } = await import("@/core/chat/chat");
    intercepted = await inboundIntercepted(ctx, customer.telegramId, text);
  }

  // «Стоп» / «отписаться» вне оформления — отписка от рассылок (WhatsApp этого
  // требует); на шаге оформления «стоп» по-прежнему отменяет оформление.
  const { optOutCommand, optOutWordsApply } = await import("@/core/customers/opt-out");
  const optCmd = optOutWordsApply(customer.state.mode) ? optOutCommand(m.text) : null;
  if (optCmd) {
    await directOptOut(ctx, customer, m, transport, optCmd);
    return processed(optCmd === "unsubscribe" ? "отписка от рассылок" : "возврат к рассылкам");
  }
  // Как в Telegram: при чате с менеджером «/start» и чек на шаге оплаты всё
  // равно идут боту — иначе покупатель, позвавший магазин, молчание получал
  // навсегда (перехват сам не снимается; Educational Bot, 30.09).
  if (intercepted) {
    const { isShopStartWord } = await import("@/core/instagram/comment-rules");
    const proofStep =
      ["awaiting_proof", "awaiting_payment", "choose_pay"].includes(customer.state.mode ?? "") &&
      m.attachments.length > 0;
    if (!isShopStartWord(m.text) && !proofStep) return processed("менеджер ведёт диалог в панели");
  }
  // Магазин на паузе (неоплата, удаление по запросу владельца): переписка
  // сохранена в «Чате», автоответы молчат — как бот Telegram на паузе.
  if (ctx.tenant.status === "paused" || ctx.tenant.status === "suspended")
    return processed("магазин на паузе");

  // Ответ на фото готового заказа (core/orders/approval): «да» — одобрено,
  // любой другой текст — правки. Ответ один: дальше диалог идёт как обычно.
  if (customer.state.mode === "awaiting_approval" && customer.state.approval_order_id) {
    const orderId = Number(customer.state.approval_order_id);
    const { recordApprovalAnswer, isApprovalYes } = await import("@/core/orders/approval");
    const { setState } = await import("@/core/customers/customers");
    const { approval_order_id: _ao, ...rest } = customer.state;
    await setState(ctx, customer, { ...rest, mode: "idle" });
    const ok = isApprovalYes(text);
    if (await recordApprovalAnswer(ctx, orderId, ok ? { ok: true } : { ok: false, text })) {
      const { getOrder, displayNo } = await import("@/core/orders/orders");
      const order = await getOrder(ctx, orderId);
      const no = order ? displayNo(order) : orderId;
      await notifyAdminsHtml(
        ctx,
        ok
          ? `✅ Покупатель одобрил фото заказа #${no}`
          : `✏️ <b>Правки к заказу #${no}</b>\n\n${escapeHtml(text.slice(0, 1000))}`,
        { kind: "question", orderId },
      ).catch(() => 0);
    }
    const m2 = COPY.ru;
    await transport.send(
      m.conversationId,
      m.accountId,
      ok ? m2.approvalThanks : m2.approvalChangesSent,
      { platform: m.platform },
    );
    return processed(ok ? "фото заказа одобрено" : "правки к фото заказа");
  }

  // Настройки автоответчика канала (те же ключи, что в v1). Выключенный —
  // молчит вовсе; консультантские ниши тумблер не читают: у них консультант
  // и есть канал.
  const { loadDirectBotSettings } = await import("@/core/instagram/direct-bot-settings");
  const { isConsultantVertical } = await import("@/core/verticals/registry");
  const bot = await loadDirectBotSettings(ctx, m.platform);
  if (!bot.enabled && !isConsultantVertical(ctx.tenant.vertical))
    return processed("автоответчик выключен в настройках канала");
  if (m.platform === "whatsapp" && bot.ignoreExcluded) {
    const { excludedPhoneSet, isExcludedSender } = await import("@/core/whatsapp/exclusions");
    const { getSetting } = await import("@/core/settings/settings");
    const excluded = excludedPhoneSet(await getSetting(ctx, "whatsapp_bot_excluded_phones"));
    if (isExcludedSender(excluded, m.senderPhone, m.senderId))
      return ignored("номер в списке исключений продавца");
  }

  // Магазин в переписке — отдельный модуль на канал; свободный вопрос
  // уходит дальше консультанту или продавцу.
  let customerNow = customer;
  const shopOn =
    m.platform === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
  if (shopOn) {
    const { handleShopMessage } = await import("./shop.server");
    const r = await handleShopMessage(ctx, customer, m, transport, bot);
    customerNow = r.customer;
    if (r.outcome === "handled") return processed("магазин");
  } else if (m.nativeOrder) {
    // Корзина из каталога Meta без магазина в переписке — продавцу текстом, как в v1.
    const { describeNativeCart } = await import("@/core/whatsapp/native-cart");
    const who = customer.username ? `@${customer.username}` : customer.firstName || m.senderId;
    await notifyAdminsHtml(
      ctx,
      describeNativeCart(escapeHtml(who), m.nativeOrder.items, m.nativeOrder.note),
      {
        kind: "native_cart",
      },
    ).catch(() => 0);
    return processed("корзина из каталога WhatsApp — продавцу");
  }

  const consultant = await import("@/core/consultant/engine.server");
  // Быстрый вопрос «Связаться с продавцом»: этот вопрос — продавцу, не консультанту.
  const { contactRequested } = await import("@/core/instagram/ice-breakers");
  if (m.text && contactRequested(customerNow.state))
    return processed(await contactSeller(ctx, customerNow, m, consultant));
  if (!(await consultant.consultantEnabled(ctx))) {
    // Модуль «Поддержка»: вопрос в Direct/WhatsApp — обращение с номером.
    const ticket = m.text ? await directTicket(ctx, customerNow, m.platform, m.text) : null;
    if (shopOn && m.text) await forwardedToSeller(ctx, customerNow, m, transport, bot, ticket);
    return processed(
      ticket
        ? `${ticket.created ? "новое обращение" : "дополнение к обращению"} #${ticket.number}`
        : "консультант выключен — сообщение в «Чате»",
    );
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
  const hours = pauseHours(ctx.tenant);
  const manager = findManagerMessage(tail, {
    lastBotReplyAt: memory.last_reply_at,
    ourReplies: [
      ...(memory.recent ?? []).filter((t) => t.role === "assistant").map((t) => t.text),
      // Ответы менеджера, пересланные из Telegram, — тоже «наши» (core/consultant/relay).
      ...(memory.relayed ?? []),
    ],
    resumedAt: memory.resumed_at,
    // «Пока не верну сам» — окна нет, смотрим обычные 12 часов.
    pauseWindowMs: hours === 0 ? undefined : hours * 3600_000,
  });
  if (manager) {
    await consultant.pauseConsultant(ctx, customer);
    return processed("менеджер отвечает из приложения — консультант на паузе");
  }

  // Консультант по прайсу видит фото покупателя (v1 BOVI): ссылки на снимки,
  // кроме самой публикации и гифок-реакций; подпись «[вложение: …]» ему не нужна.
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  const imageUrls = pricelistMode(ctx.tenant) ? customerImageUrls(m) : [];
  const r = await consultant.runConsultant(ctx, customer, imageUrls.length ? m.text : text, {
    platform: m.platform,
    story: { storyId: m.storyId, mediaUrl: m.storyMediaUrl },
    ...(imageUrls.length ? { imageUrls } : {}),
  });
  if (!r) return { status: "failed", note: "консультант не ответил (см. consultant_last_error)" };

  const sent = await transport.send(m.conversationId, m.accountId, r.reply, {
    platform: m.platform,
  });
  // Журнал ответов: цена ответа, кеш, инструменты — и что ответ не ушёл.
  const { recordConsultantRun } = await import("@/core/consultant/runs");
  const { currentZernioEventId } = await import("./event-context.server");
  await recordConsultantRun(ctx, {
    messageId: m.platformMessageId ?? currentZernioEventId() ?? "",
    conversationId: m.conversationId,
    accountId: m.accountId,
    userKey: customer.userKey,
    source: "webhook",
    incomingText: text,
    replyText: r.reply,
    replyKind: r.handoff ? `handoff:${r.handoff.reason}` : "reply",
    model: r.model ?? null,
    usage: r.usage,
    rate: r.rate ?? null,
    tools: r.tools,
    ...(sent.ok ? {} : { status: "terminal_failed" as const, errorCode: "send_failed" }),
  });
  if (!sent.ok) return { status: "failed", note: sent.error };
  // Фото и видео товара из фотобазы — следом за ответом, каждое отдельно.
  // Не принял Instagram файл — ответ уже ушёл, остальное не держим.
  for (const a of r.attachments ?? []) {
    const media = await transport.send(m.conversationId, m.accountId, "", {
      platform: m.platform,
      attachmentUrl: a.url,
      attachmentType: a.kind,
    });
    if (!media.ok) console.warn(`[zernio] фото товара не ушло ${customer.userKey}: ${media.error}`);
  }

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
    const { leadFromHandoff } = await import("@/core/pipeline/sources");
    await leadFromHandoff(ctx, customer, r.handoff);
    const who = customer.firstName || (customer.username ? `@${customer.username}` : m.senderId);
    // Модуль «Поддержка»: передача менеджеру — обращение, итог консультанта — его тема.
    const ticket = await directTicket(ctx, customer, m.platform, r.handoff.summary, {
      notify: false,
    });
    const lines = [
      ticket ? `📨 Обращение #${ticket.number}` : "",
      r.handoff.kind === "lead"
        ? `📝 <b>Заявка от ИИ-консультанта</b> (${escapeHtml(r.handoff.reason)})`
        : `🙋 <b>Клиент ждёт менеджера</b> (${escapeHtml(r.handoff.reason)})`,
      `${PLATFORM_LABEL[m.platform]} · 👤 ${escapeHtml(who)}${customer.username ? ` · @${escapeHtml(customer.username)}` : ""}`,
      r.handoff.customerName ? `Имя: ${escapeHtml(r.handoff.customerName)}` : "",
      r.handoff.customerContact ? `📞 ${escapeHtml(r.handoff.customerContact)}` : "",
      `📋 ${escapeHtml(r.handoff.summary)}`,
      "",
      `Ответьте в разделе «Чат» панели или прямо в ${PLATFORM_LABEL[m.platform]} — консультант в этом диалоге ${pauseNoticeRu(pauseHours(ctx.tenant))}.`,
    ].filter((l) => l !== "");
    // Метка для ответа свайпом в Telegram — он уйдёт покупателю (core/consultant/relay).
    const { handoffRefLine, issueHandoffRef } = await import("@/core/consultant/relay");
    const ref = await issueHandoffRef(ctx, customer.userKey).catch(() => null);
    if (ref) lines.push(handoffRefLine(ref));
    await notifyAdminsHtml(ctx, lines.join("\n"), { kind: r.handoff.kind }).catch(() => 0);
  }
  return processed(r.handoff ? `ответ + передача менеджеру (${r.handoff.reason})` : undefined);
}

/** Отписка или возврат в Direct/WhatsApp: флаг и короткое подтверждение. */
async function directOptOut(
  ctx: TenantContext,
  customer: Customer,
  m: ReturnType<typeof parseZernioMessage>,
  transport: ZernioTransport,
  cmd: import("@/core/customers/opt-out").OptOutCommand,
) {
  const { setOptOut } = await import("@/core/customers/opt-out");
  await setOptOut(ctx, customer.userKey, cmd === "unsubscribe");
  const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const copy = COPY[locale] ?? COPY.ru;
  const text = cmd === "unsubscribe" ? copy.unsubscribedDirect : copy.resubscribed;
  const r = await transport.send(m.conversationId!, m.accountId!, text, { platform: m.platform });
  if (r.ok && ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: customer.telegramId,
      direction: "out",
      sender: "bot",
      text,
    });
  }
}

/**
 * Магазин включён, консультанта нет, а покупатель задал вопрос: один раз
 * сказать, что продавец ответит здесь, и как заказать. Повтор в течение
 * часа подавляется — иначе на каждую реплику диалога прилетал бы один и
 * тот же ответ (v1: «Передал ваш вопрос продавцу» дважды подряд).
 */
const ORDER_HINT_RU = "Чтобы заказать самостоятельно, напишите номер товара или «каталог».";

async function forwardedToSeller(
  ctx: TenantContext,
  customer: Customer,
  m: ReturnType<typeof parseZernioMessage>,
  transport: ZernioTransport,
  bot: import("@/core/instagram/direct-bot-settings").DirectBotSettings,
  ticket: { number: number; created: boolean } | null = null,
) {
  // «Только по заказам»: вне сценария покупки бот молчит, чтобы диалог
  // остался непрочитанным для продавца в приложении (решение из v1).
  const mode = customer.state.mode;
  const inFlow = Boolean(mode) && mode !== "idle";
  if (bot.scope === "purchases" && !inFlow && !bot.script) return;
  const direct = customer.state.direct;
  const mem = direct && typeof direct === "object" && !Array.isArray(direct) ? direct : {};
  const at = Date.parse(String(mem.forwarded_at ?? ""));
  if (Number.isFinite(at) && Date.now() - at < 3600_000) return;
  const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const text =
    bot.script ||
    // Открытое обращение — и через час покупатель видит его номер, а не общий ответ.
    (ticket
      ? (ticket.created
          ? (COPY[locale] ?? COPY.ru).ticketCreated(ticket.number)
          : (COPY[locale] ?? COPY.ru).ticketAppended(ticket.number)) +
        (locale === "ru" ? ` ${ORDER_HINT_RU}` : "")
      : `Передал ваш вопрос продавцу — он ответит здесь. ${ORDER_HINT_RU}`);
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

/**
 * Вопрос после «Связаться с продавцом»: обращение (модуль «Поддержка») или
 * уведомление продавцу; ИИ-консультант замолкает, чтобы ответил человек.
 * Метку забирает условная запись (core/instagram/contact-request): из двух
 * сообщений подряд продавцу уходит одно, второе остаётся в «Чате».
 * Пауза пишется поверх свежего state.
 */
async function contactSeller(
  ctx: TenantContext,
  customer: Customer,
  m: ReturnType<typeof parseZernioMessage>,
  consultant: typeof import("@/core/consultant/engine.server"),
): Promise<string> {
  const { claimContactRequest } = await import("@/core/instagram/contact-request");
  let c = await claimContactRequest(ctx, customer);
  // Метку забрало соседнее сообщение: оно и уходит продавцу, это видно в «Чате».
  if (!c) return "просьба связаться — вопрос уже у продавца";
  const ticket = await directTicket(ctx, c, m.platform, m.text);
  if (!ticket) {
    const who = c.firstName || (c.username ? `@${c.username}` : m.senderId);
    await notifyAdminsHtml(
      ctx,
      `🙋 <b>Покупатель просит связаться</b>\n${PLATFORM_LABEL[m.platform]} · 👤 ${escapeHtml(who)}${c.username ? ` · @${escapeHtml(c.username)}` : ""}\n\n${escapeHtml(m.text.slice(0, 1000))}\n\nОтветить — в приложении ${PLATFORM_LABEL[m.platform]} или в «Чате» панели.`,
      { kind: "question" },
    ).catch(() => 0);
  }
  if (await consultant.consultantEnabled(ctx)) c = await consultant.pauseConsultant(ctx, c);
  return ticket
    ? `просьба связаться — обращение #${ticket.number}`
    : "просьба связаться — вопрос продавцу";
}

/**
 * Модуль «Поддержка» (helpdesk при manager_chat): вопрос покупателя из
 * Instagram/WhatsApp — обращение, как «Связаться» в Telegram. Пока
 * обращение открыто, следующие вопросы дописываются в него. О новом
 * обращении — админам (кроме передачи от консультанта: у неё своё
 * уведомление). Сбой учёта не мешает переписке: null.
 */
async function directTicket(
  ctx: TenantContext,
  customer: Customer,
  platform: string,
  subject: string,
  opts: { notify?: boolean } = {},
): Promise<{ number: number; created: boolean } | null> {
  if (!ctx.tenant.modules.helpdesk || !ctx.tenant.modules.manager_chat) return null;
  if (!subject.trim()) return null;
  try {
    const { createTicket } = await import("@/core/helpdesk/tickets");
    const who = customer.firstName || (customer.username ? `@${customer.username}` : null);
    const { ticket, created } = await createTicket(ctx, {
      telegramId: customer.telegramId,
      customerName: who,
      platform,
      subject,
    });
    if (created && opts.notify !== false)
      await notifyAdminsHtml(
        ctx,
        `📨 <b>Новое обращение #${ticket.number}</b>\n${PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform} · 👤 ${escapeHtml(who ?? customer.userKey)}\n\n${escapeHtml(subject.slice(0, 1000))}\n\nОтветить — раздел «Чат», статус — «Обращения» в панели.`,
        { kind: "question" },
      ).catch(() => 0);
    return { number: ticket.number, created };
  } catch (e) {
    console.error(`[zernio:${ctx.tenant.id}] обращение не записано`, e);
    return null;
  }
}

/** Фото покупателя в сообщении: не публикация (сторис, рилс) и не гифка из стикеров (v1 incomingImageUrls). */
export function customerImageUrls(m: ReturnType<typeof parseZernioMessage>): string[] {
  return m.attachments
    .filter((a) => a.type === "image" && a.url !== m.storyMediaUrl && !/giphy\.com/i.test(a.url))
    .map((a) => a.url)
    .slice(0, 3);
}
