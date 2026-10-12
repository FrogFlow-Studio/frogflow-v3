import type { TenantContext } from "@/core/tenant/resolve.server";
import { isBlocked, upsertCustomer, type Customer } from "@/core/customers/customers";
import { COPY, escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { liveTransport, type ZernioTransport } from "./api.server";
import { findManagerMessage } from "./manager-guard";
import { pauseHours, pauseNoticeRu } from "@/core/consultant/pause";
import {
  messageAsText,
  parseZernioMessage,
  type ParsedZernioMessage,
  type ZernioWebhookMessagePayload,
} from "./message";
import { PLATFORM_LABEL } from "./platform";
import { makeReason } from "@/core/chat/reason";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { isLocale } from "@/core/i18n/locale";
import { currentZernioEventId } from "./event-context.server";
import { isPollEvent, zernioMessageKeys } from "./inbox-poll";
import type { TwoStepBuyer } from "./automations.server";

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

/**
 * Исходящее сообщение: бот его не разбирает. Если написал человек (продавец
 * руками) и в диалоге говорит магазин — начинается пауза бота (seller-pause).
 */
async function handleOutgoing(ctx: TenantContext, m: ParsedZernioMessage): Promise<HandleResult> {
  // Консультант по прайсу: менеджер ответил в приложении — задачи покупателя сделаны.
  await closeTasksOnSellerReply(ctx, m);
  const shopOn =
    m.platform === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
  const channelOn =
    m.platform === "whatsapp" ? ctx.tenant.modules.whatsapp : ctx.tenant.modules.instagram;
  if (!shopOn || !channelOn || m.senderId === "unknown") return ignored("исходящее сообщение");
  const { getCustomer, userKey } = await import("@/core/customers/customers");
  const customer = await getCustomer(ctx, userKey(m.platform, m.senderId));
  if (!customer) return ignored("исходящее сообщение");
  const { loadDirectBotSettings } = await import("@/core/instagram/direct-bot-settings");
  const { handleSellerOutgoing } = await import("./seller-pause");
  const bot = await loadDirectBotSettings(ctx, m.platform);
  const direct = customer.state.direct as { last_reply?: string } | undefined;
  const paused = await handleSellerOutgoing(ctx, customer, m, bot.sellerPause, direct?.last_reply);
  return ignored(paused ? "продавец ответил руками — бот на паузе" : "исходящее сообщение");
}

/**
 * Исходящее, написанное человеком (продавец в приложении Instagram/WhatsApp
 * или в инбоксе Zernio), закрывает открытые задачи консультанта по этому
 * покупателю (core/consultant/tasks, условная запись). Эхо наших же ответов
 * (бот, пересланный из Telegram ответ менеджера) — не ответ человека.
 */
async function closeTasksOnSellerReply(ctx: TenantContext, m: ParsedZernioMessage) {
  if (!ctx.tenant.modules[m.platform] || m.senderId === "unknown") return;
  if (m.sentVia !== null && m.sentVia !== "human") return;
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(ctx.tenant)) return;
  const { getCustomer, userKey } = await import("@/core/customers/customers");
  const customer = await getCustomer(ctx, userKey(m.platform, m.senderId));
  if (!customer) return;
  const memory = consultantMemory(customer);
  const direct = customer.state.direct as { last_reply?: string } | undefined;
  const ours = [
    ...(memory.recent ?? []).filter((t) => t.role === "assistant").map((t) => t.text),
    ...(memory.relayed ?? []),
    ...(typeof direct?.last_reply === "string" ? [direct.last_reply] : []),
  ];
  const { isPersonMessage } = await import("./manager-guard");
  if (!isPersonMessage({ direction: "outgoing", message: m.text, sentVia: m.sentVia }, ours))
    return;
  const sent = m.sentAt ? Date.parse(m.sentAt) : NaN;
  const { closeTaskAfterReply } = await import("@/core/consultant/tasks");
  await closeTaskAfterReply(ctx, customer.userKey, new Date(), {
    via: m.platform,
    ...(Number.isFinite(sent) ? { repliedAt: new Date(sent) } : {}),
  });
}

/** Сколько «+» ждёт вебхук комментария (тесты ставят 0). */
export const PLUS_WAIT = { ms: 4000 };

export async function handleZernioMessage(
  ctx: TenantContext,
  payload: ZernioWebhookMessagePayload,
  transport: ZernioTransport = liveTransport,
): Promise<HandleResult> {
  const m = parseZernioMessage(payload);
  if (m.outgoing) return handleOutgoing(ctx, m);
  if (!m.conversationId || !m.accountId) return ignored("нет conversationId или accountId");
  if (!ctx.tenant.modules[m.platform])
    return ignored(`модуль «${PLATFORM_LABEL[m.platform]}» у клиента выключен`);

  // Одно входящее — одна обработка, кто бы его ни принёс: вебхук или опрос
  // ящика (inbox-poll.server). Метка — условная запись до любой отправки.
  const eventId = currentZernioEventId();
  const viaPoll = isPollEvent(eventId);
  const keys = zernioMessageKeys({
    id: payload.message?.id,
    platformMessageId: m.platformMessageId,
  });
  if (keys.length) {
    const { claimZernioMessageKeys } = await import("./message-claim.server");
    const claim = await claimZernioMessageKeys(ctx, keys, eventId ?? "direct", m.conversationId);
    if (claim === "lost") return ignored("сообщение уже обработано (вебхук или опрос ящика)");
    // Вебхук при сбое базы отвечает (молчание дороже), опрос — нет: он лишь запасной путь.
    if (claim === "unknown" && viaPoll) return ignored("опрос: метка сообщения не записалась");
  }

  let customer = await upsertCustomer(ctx, m.platform, m.senderId, {
    username: m.senderUsername || null,
    firstName: m.senderName,
    zernioConversationId: m.conversationId,
    zernioAccountId: m.accountId,
    contactPhone: m.senderPhone || null,
    metadata: m.metadata,
  });
  if (await isBlocked(ctx, customer.telegramId)) return ignored("покупатель заблокирован");

  // Продаёт ли клиент сейчас (core/tenant/sells): консультант без товаров (BOVI)
  // с модулем магазина из v1 — нет, тогда сценарий магазина пропускаем и отвечает
  // консультант. Считается один раз на сообщение и только когда нужен.
  let sellsMemo: Promise<boolean> | null = null;
  const sells = () => (sellsMemo ??= sellsNowOrShop(ctx));

  // Двухшаговая Comment-to-DM: покупатель написал первым после комментария —
  // отдаём обещанное второе сообщение с кнопками; «+»/«да» дальше не разбираем.
  if (m.platform === "instagram" && m.senderUsername && ctx.tenant.modules.instagram) {
    const { deliverPendingTwoStepDm, deliverTwoStepFromDm, twoStepJustDelivered } =
      await import("./automations.server");
    const { isTwoStepAcknowledgement, isShopStartWord } =
      await import("@/core/instagram/comment-rules");
    // Заказ сразу — только на явное согласие: ответ на призыв «+»/«да»/«хочу»
    // набранным текстом. Вопрос («в Беларусь высылаете?»), «❤️», фото — обычное
    // второе сообщение с «Купить»: заказ появится по нажатию, а сам вопрос идёт
    // дальше обычным путём (Копилка 10.10, ложные заказы #115, #121).
    const consent =
      Boolean(m.text?.trim()) &&
      !m.postbackPayload &&
      m.attachments.length === 0 &&
      isTwoStepAcknowledgement(m.text);
    const who: TwoStepBuyer = {
      accountId: m.accountId,
      conversationId: m.conversationId,
      username: m.senderUsername,
      senderId: m.senderId,
      // Быстрая покупка: «Купить» правила сразу становится заказом с кнопками
      // оплаты, без корзины (Копилка русоведа, 09.10). Магазин решает сам,
      // включена ли она; false — уходит обычное второе сообщение.
      express: async (productId) => {
        if (!consent || !ctx.tenant.modules.dm_shop || !(await sells())) return false;
        const { expressFromAutomation } = await import("./shop.server");
        return expressFromAutomation(
          ctx,
          customer,
          { conversationId: m.conversationId!, accountId: m.accountId!, productId },
          transport,
        );
      },
    };
    const pending = () => deliverPendingTwoStepDm(ctx, who);
    let delivered = await pending();
    // Второй быстрый «+» после уже отданного второго сообщения тоже не разбираем.
    // Только набранный ответ: нажатие кнопки второго сообщения и фото чека идут дальше.
    const typedOnly = !m.postbackPayload && m.attachments.length === 0 && !m.nativeOrder;
    const toShop = ctx.tenant.modules.dm_shop && isShopStartWord(m.text) && (await sells());
    const justDelivered = () =>
      twoStepJustDelivered(ctx, who.username, payload.message?.sentAt ?? null);
    let ack = delivered || (typedOnly && (await justDelivered()));
    // «+» обогнал вебхук комментария (или тот не пришёл): второго сообщения нет
    // в очереди — покупатель получал его только после следующей реплики, а «+»
    // уходил в обращение (Кристина Дидактика, 07.10, обращение #25).
    // Первое сообщение правила уже в переписке — по нему отдаём второе сами.
    // Только вне шага магазина: там «1»/«да» — выбор, а не ответ на призыв.
    const mode = customer.state.mode;
    const inStep = Boolean(mode) && mode !== "idle";
    if (
      !ack &&
      !toShop &&
      typedOnly &&
      !inStep &&
      m.text?.trim() &&
      isTwoStepAcknowledgement(m.text)
    )
      ack = await deliverTwoStepFromDm(ctx, who);
    if (!ack && !toShop && typedOnly && m.text?.trim() === "+") {
      await new Promise((r) => setTimeout(r, PLUS_WAIT.ms));
      delivered = await pending();
      ack = delivered || (await justDelivered());
      // Первое сообщение, отправленное вручную, Zernio показывает в переписке
      // не сразу: читаем её ещё раз (Копилка 12.10, maryyyyisaaaa: «Палитру»
      // прислали ответом на старый комментарий, «+» ушёл в обращение #147).
      if (!ack && !inStep) ack = await deliverTwoStepFromDm(ctx, who);
    }
    if (!toShop && isTwoStepAcknowledgement(m.text) && ack)
      return processed("второе сообщение по комментарию");
    // Кодовое слово из рилса прямо в Direct («Палитра») — сообщение правила с
    // кнопками сразу, а не обращение продавцу (Копилка русоведа, 09.10).
    // Ответ на только что показанный список разделов («Оформление и праздники»)
    // — выбор раздела, его разбирает магазин (Копилка, заказ #127, 11.10).
    // Неточное совпадение с разделом («Папка профориентатора» при разделе
    // «Папки») уступает кодовому слову правила.
    if (!ack && !toShop && typedOnly && !inStep && m.text?.trim()) {
      const { listedSectionByName } = await import("./shop/catalog.server");
      const section = await listedSectionByName(ctx, customer, m.text);
      const { deliverTwoStepForDmKeyword } = await import("./automations.server");
      if (!section?.exact && (await deliverTwoStepForDmKeyword(ctx, who, m.text)))
        return processed("кодовое слово в Direct — сообщение правила");
    }
    // «+» на сообщение с призывом, которое не первое сообщение нашего правила
    // (материал под бесплатным постом): товар не угадываем — спрашиваем, какой
    // нужен (Копилка, 12.10: «+» после «Зори» оформил «Палитру», заказ #144).
    if (
      !ack &&
      !toShop &&
      typedOnly &&
      !inStep &&
      m.text?.trim() &&
      isTwoStepAcknowledgement(m.text) &&
      ctx.tenant.modules.dm_shop &&
      (await sells())
    ) {
      const { plusAnswersUnknownPrompt } = await import("./automations.server");
      const asked = await plusAnswersUnknownPrompt(
        ctx,
        who,
        undefined,
        undefined,
        m.text?.trim() === "+",
      );
      if (asked === "asked") return processed("«+» без правила — вопрос о товаре уже задан");
      if (asked === "ask") {
        const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
        const mm = COPY[locale] ?? COPY.ru;
        await transport.send(m.conversationId, m.accountId, mm.plusWhichProduct, {
          platform: m.platform,
          buttons: [{ type: "postback", title: mm.catalog, payload: "CATALOG" }],
        });
        return processed("«+» без правила — спросили, какой товар");
      }
    }
  }

  const text = messageAsText(m);
  if (!text) return ignored("пустое сообщение");

  // Ответ цифрой 1–5 на просьбу оценить закрытое обращение — раньше «менеджер ведёт диалог».
  // Цифра — оценка, только если это первое сообщение после просьбы и покупатель не в шаге
  // сценария магазина (там цифра — выбор товара, оплаты, языка). Любое другое сообщение
  // снимает ожидание: «привет», а потом «3» — уже выбор в магазине.
  if (ctx.tenant.modules.helpdesk && !m.postbackPayload) {
    const { ticketAwaitingRating, rateTicket, clearRatingAsked } =
      await import("@/core/helpdesk/tickets");
    const asked = await ticketAwaitingRating(ctx, customer.telegramId);
    if (asked) {
      const mode = customer.state.mode;
      const inStep = Boolean(mode) && mode !== "idle";
      if (/^[1-5]$/.test(text.trim()) && !inStep) {
        const score = Number(text.trim());
        const r = await rateTicket(ctx, asked.id, customer.telegramId, score);
        if (r !== "invalid") {
          const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
          const mm = COPY[locale] ?? COPY.ru;
          await transport.send(
            m.conversationId,
            m.accountId,
            r === "rated" ? mm.ticketRateThanks(score) : mm.ticketRateAlready,
            { platform: m.platform },
          );
          return processed(`оценка обращения #${asked.number}: ${score}`);
        }
      }
      await clearRatingAsked(ctx, asked.id);
    }
  }

  // «Мои обращения» словом: номер, статус и тема своих обращений (и при диалоге с менеджером).
  if (ctx.tenant.modules.helpdesk && !m.postbackPayload) {
    const { isMyTicketsWord, myTickets } = await import("@/core/helpdesk/mine");
    const mode = customer.state.mode;
    if (isMyTicketsWord(text) && (!mode || mode === "idle")) {
      const { myTicketsText, DATE_LOCALE } = await import("@/channels/telegram/copy");
      const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
      const list = await myTickets(ctx, customer.telegramId);
      await transport.send(
        m.conversationId,
        m.accountId,
        myTicketsText(COPY[locale] ?? COPY.ru, list, {
          html: false,
          date: (iso) =>
            new Date(iso).toLocaleDateString(DATE_LOCALE[locale] ?? "ru-RU", {
              day: "numeric",
              month: "short",
              timeZone: ctx.timezone,
            }),
        }),
        { platform: m.platform },
      );
      return processed("мои обращения");
    }
  }

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
    const toShop = isShopStartWord(m.text) && (await sells());
    if (!toShop && !proofStep) return processed("менеджер ведёт диалог в панели");
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
  // «Позвать продавца» словом: пауза бота, карточка продавцу, ответ — свайпом из Telegram.
  if (shopOn && m.text && !m.postbackPayload && !intercepted) {
    const { isHumanCallWord, callHuman } = await import("./human-call");
    if (isHumanCallWord(m.text)) {
      const called = await callHuman(ctx, customer, m, transport);
      if (called.handled) return processed(called.note);
    }
  }
  if (shopOn) {
    // Продавец в диалоге — бот на паузе: отвечает только на явные команды.
    const { sellerPauseActive } = await import("./seller-pause");
    const gate = await sellerPauseActive(ctx, customer, m, transport, bot.sellerPause);
    customer = gate.customer;
    if (gate.paused) return processed("продавец ведёт диалог — бот на паузе");
    // Консультант без товаров: каталог пуст — сразу консультанту.
    if (await sells()) {
      const { handleShopMessage } = await import("./shop.server");
      const r = await handleShopMessage(ctx, customer, m, transport, bot);
      customerNow = r.customer;
      if (r.outcome === "handled") return processed("магазин");
    } else customerNow = customer;
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
    if (shopOn && m.text)
      await forwardedToSeller(ctx, customerNow, m, transport, bot, ticket, await sells());
    return processed(
      ticket
        ? `${ticket.created ? "новое обращение" : "дополнение к обращению"} #${ticket.number}`
        : "консультант выключен — сообщение в «Чате»",
    );
  }
  if (consultant.isPaused(customerNow)) {
    // Телефон после передачи заказа (заказ ушёл без него) — в задачу менеджеру.
    const { phoneIn } = await import("@/core/consultant/memory");
    const phone = m.text ? phoneIn(m.text) : undefined;
    if (phone) {
      const { addContactToOpenTask } = await import("@/core/consultant/tasks");
      await addContactToOpenTask(ctx, customerNow.userKey, phone);
    }
    // В журнал ответов: сводка качества считает, сколько раз бот молчал при менеджере.
    await recordSilentRun(ctx, customerNow, m, text, "paused");
    return processed("консультант на паузе");
  }
  customer = customerNow;
  // Стикер или гифка-реакция — не вопрос (v1 BOVI): консультант молчит.
  const inbox = await import("./consultant-inbox");
  if (inbox.consultantIgnoresSticker(m)) return ignored("стикер — консультант не отвечает");

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
    // Менеджер ответил в приложении: его задачи по этому покупателю сделаны.
    const { closeTaskAfterReply } = await import("@/core/consultant/tasks");
    await closeTaskAfterReply(ctx, customer.userKey, new Date(), {
      via: m.platform,
      repliedAt: new Date(manager.at),
    });
    await recordSilentRun(ctx, customer, m, text, "manager");
    return processed("менеджер отвечает из приложения — консультант на паузе");
  }

  // Консультант по прайсу видит фото покупателя (v1 BOVI): ссылки на снимки,
  // кроме самой публикации и гифок-реакций; подпись «[вложение: …]» ему не нужна.
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  const imageUrls = pricelistMode(ctx.tenant) ? customerImageUrls(m) : [];
  // Голосовое — «напишите текстом»; публикация без слов — ждёт вопроса (consultant-inbox).
  const pre = await inbox.beforeConsultant(ctx, customer, m, transport, {
    customerPhotos: customerImageUrls(m).length,
  });
  if (pre.done) return processed(pre.note);
  customer = pre.customer;
  const r = await consultant.runConsultant(ctx, customer, imageUrls.length ? m.text : text, {
    platform: m.platform,
    story: pre.story,
    ...(imageUrls.length ? { imageUrls } : {}),
    shopInChat: shopOn,
    messageId: m.platformMessageId ?? currentZernioEventId() ?? null,
    sentAt: m.sentAt ?? payload.timestamp ?? null,
  });
  if (!r) return { status: "failed", note: "консультант не ответил (см. consultant_last_error)" };
  // Ответа нет: сообщение ушло в соседний ход, ждёт следующего или устарело (core/consultant/burst).
  if (r.skipped) {
    await recordSilentRun(ctx, customer, m, text, r.skipped);
    return processed(SKIPPED_NOTE[r.skipped]);
  }

  const sent = await transport.send(m.conversationId, m.accountId, r.reply, {
    platform: m.platform,
  });
  // Журнал ответов: цена ответа, кеш, инструменты — и что ответ не ушёл.
  const { recordConsultantRun } = await import("@/core/consultant/runs");
  await recordConsultantRun(ctx, {
    messageId: m.platformMessageId ?? currentZernioEventId() ?? "",
    conversationId: m.conversationId,
    accountId: m.accountId,
    userKey: customer.userKey,
    source: isPollEvent(currentZernioEventId()) ? "poll" : "webhook",
    incomingText: text,
    replyText: r.reply,
    replyKind: r.handoff ? `handoff:${r.handoff.reason}` : "reply",
    model: r.model ?? null,
    usage: r.usage,
    rate: r.rate ?? null,
    tools: r.tools,
    ...(sent.ok ? {} : { status: "terminal_failed" as const, errorCode: "send_failed" }),
  });
  if (!sent.ok) {
    // Ответ мог и дойти (обрыв, тайм-аут, 5xx): не повторяем и не шлём иначе.
    // Продавцу — карточка передачи с пометкой (пауза этого хода — из-за передачи,
    // и о ней продавец теперь знает) или короткое «ответ не ушёл»: без передачи
    // пауза не ставится, следующий вопрос бот примет как обычно.
    if (r.handoff) await notifyHandoff(ctx, customer, m, r.handoff, { replyNotSent: true });
    else await notifyReplyNotSent(ctx, customer, m, text, r.reply);
    return { status: "failed", note: sent.error };
  }
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
      reason: makeReason({ source: "consultant", handoff: r.handoff ? true : undefined }),
    });
  }

  if (r.handoff) {
    await notifyHandoff(ctx, customer, m, r.handoff);
    // Передача из-за долгого сбоя ИИ (деньги, ключ) — продавцу отдельно, раз в три часа.
    const { alertSellerModelFailure } = await import("@/core/consultant/model-alert.server");
    await alertSellerModelFailure(ctx, (html) =>
      notifyAdminsHtml(ctx, html, { kind: "consultant_model" }),
    );
  }
  return processed(r.handoff ? `ответ + передача менеджеру (${r.handoff.reason})` : undefined);
}

type ParsedMessage = ReturnType<typeof parseZernioMessage>;

const SKIPPED_NOTE: Record<NonNullable<ConsultantSkip>, string> = {
  folded: "сообщение вошло в соседний ход консультанта — ответ там",
  busy: "консультант занят соседним ходом — сообщение ждёт следующего",
  paused: "пока ждали, соседний ход передал диалог менеджеру",
  stale: "сообщение доставлено с опозданием — без ответа",
};
type ConsultantSkip = import("@/core/consultant/engine.server").ConsultantResult["skipped"];

/**
 * Ход консультанта без ответа (пауза, менеджер в чате, сообщение вошло в
 * соседний ход или устарело) — строка cancelled в журнале ответов.
 */
async function recordSilentRun(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedMessage,
  text: string,
  why: "paused" | "manager" | NonNullable<ConsultantSkip>,
) {
  const { recordConsultantRun } = await import("@/core/consultant/runs");
  await recordConsultantRun(ctx, {
    messageId: m.platformMessageId ?? currentZernioEventId() ?? "",
    conversationId: m.conversationId!,
    accountId: m.accountId,
    userKey: customer.userKey,
    source: isPollEvent(currentZernioEventId()) ? "poll" : "webhook",
    incomingText: text,
    replyKind: why,
    status: "cancelled",
  });
}

/**
 * Передача менеджеру: «Чат», воронка, обращение и карточка продавцу.
 * `replyNotSent` — фраза покупателю не подтверждена каналом: в карточке пометка.
 */
async function notifyHandoff(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedMessage,
  handoff: import("@/core/consultant/engine.server").Handoff,
  opts: { replyNotSent?: boolean } = {},
) {
  if (ctx.tenant.modules.manager_chat) {
    const { connect } = await import("@/core/chat/chat");
    await connect(ctx, customer.telegramId).catch(() => {});
  }
  const { leadFromHandoff } = await import("@/core/pipeline/sources");
  await leadFromHandoff(ctx, customer, handoff);
  const who = customer.firstName || (customer.username ? `@${customer.username}` : m.senderId);
  // Модуль «Поддержка»: передача менеджеру — обращение, итог консультанта — его тема.
  const ticket = await directTicket(ctx, customer, m.platform, handoff.summary, {
    notify: false,
  });
  const warn = opts.replyNotSent ? await replyNotSentLines(ctx) : [];
  // Товары разговора и кнопка «открыть диалог» (v1 consultant/notify.ts).
  const { handoffCardExtras } = await import("./handoff-card");
  const card = await handoffCardExtras(ctx, customer, m);
  // Задача консультанта в админке — до уведомления: сбой отправки её не теряет.
  const { taskFromHandoff } = await import("@/core/consultant/tasks");
  await taskFromHandoff(ctx, customer, handoff, {
    channel: m.platform,
    products: card.products,
    link: card.link,
    sourceId: m.platformMessageId,
  });
  const lines = [
    ...warn,
    ticket ? `📨 Обращение #${ticket.number}` : "",
    handoff.kind === "lead"
      ? `📝 <b>Заявка от ИИ-консультанта</b> (${escapeHtml(handoff.reason)})`
      : `🙋 <b>Клиент ждёт менеджера</b> (${escapeHtml(handoff.reason)})`,
    `${PLATFORM_LABEL[m.platform]} · 👤 ${escapeHtml(who)}${customer.username ? ` · @${escapeHtml(customer.username)}` : ""}`,
    handoff.customerName ? `Имя: ${escapeHtml(handoff.customerName)}` : "",
    handoff.customerContact ? `📞 ${escapeHtml(handoff.customerContact)}` : "",
    `📋 ${escapeHtml(handoff.summary)}`,
    ...card.lines,
    "",
    `Ответьте в разделе «Чат» панели или прямо в ${PLATFORM_LABEL[m.platform]} — консультант в этом диалоге ${pauseNoticeRu(pauseHours(ctx.tenant))}.`,
  ].filter((l) => l !== "");
  // Метка для ответа свайпом в Telegram — он уйдёт покупателю (core/consultant/relay).
  const { handoffRefLine, issueHandoffRef } = await import("@/core/consultant/relay");
  const ref = await issueHandoffRef(ctx, customer.userKey).catch(() => null);
  if (ref) lines.push(handoffRefLine(ref));
  await notifyAdminsHtml(ctx, lines.join("\n"), {
    kind: handoff.kind,
    ...(card.replyMarkup ? { replyMarkup: card.replyMarkup } : {}),
  }).catch(() => 0);
}

/** Заголовок и подсказка «ответ не ушёл» на языке продавца. */
async function replyNotSentLines(ctx: TenantContext): Promise<string[]> {
  const { sellerLocaleSafe } = await import("@/core/ai/seller-text");
  const { replyNotSentHint, replyNotSentTitle } = await import("@/core/consultant/messages");
  const l = await sellerLocaleSafe(ctx);
  return [replyNotSentTitle(l), replyNotSentHint(l), ""];
}

/** Ответ без передачи не ушёл: продавцу вопрос и ответ бота, чтобы ответил сам. */
async function notifyReplyNotSent(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedMessage,
  question: string,
  reply: string,
) {
  const { sellerLocaleSafe } = await import("@/core/ai/seller-text");
  const { botAnsweredLabel, questionLabel, replyNotSentHint, replyNotSentTitle } =
    await import("@/core/consultant/messages");
  const l = await sellerLocaleSafe(ctx);
  const who = customer.firstName || (customer.username ? `@${customer.username}` : m.senderId);
  const lines = [
    replyNotSentTitle(l),
    `${PLATFORM_LABEL[m.platform]} · 👤 ${escapeHtml(who)}${customer.username ? ` · @${escapeHtml(customer.username)}` : ""}`,
    `💬 ${questionLabel(l)}: ${escapeHtml(question.slice(0, 500))}`,
    `🤖 ${botAnsweredLabel(l)}: ${escapeHtml(reply.slice(0, 700))}`,
    "",
    replyNotSentHint(l),
  ];
  await notifyAdminsHtml(ctx, lines.join("\n"), { kind: "question" }).catch(() => 0);
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
      reason: makeReason({ cmd: cmd === "unsubscribe" ? "unsubscribe" : "resubscribe" }),
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
  sells = true,
) {
  // «Только по заказам»: вне сценария покупки бот молчит, чтобы диалог
  // остался непрочитанным для продавца в приложении (решение из v1).
  // Посреди покупки тоже: «передал продавцу» на реплику, адресованную
  // продавцу, путал покупателей (Educational Bot, 03.10).
  if (bot.scope === "purchases" && !bot.script) return;
  const direct = customer.state.direct;
  const mem = direct && typeof direct === "object" && !Array.isArray(direct) ? direct : {};
  const at = Date.parse(String(mem.forwarded_at ?? ""));
  if (Number.isFinite(at) && Date.now() - at < 3600_000) return;
  const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  // Консультант без товаров: «напишите «каталог»» звал бы в пустой каталог.
  const { handoffReply } = await import("@/core/consultant/messages");
  const text =
    bot.script ||
    // Открытое обращение — и через час покупатель видит его номер, а не общий ответ.
    (ticket
      ? (ticket.created
          ? (COPY[locale] ?? COPY.ru).ticketCreated(ticket.number)
          : (COPY[locale] ?? COPY.ru).ticketAppended(ticket.number)) +
        (locale === "ru" && sells ? ` ${ORDER_HINT_RU}` : "")
      : sells
        ? `Передал ваш вопрос продавцу — он ответит здесь. ${ORDER_HINT_RU}`
        : handoffReply(isLocale(locale) ? locale : "ru"));
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
      reason: makeReason({ source: "forward", rule: "to_seller" }),
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
    if (created && opts.notify !== false) {
      const { noticeLocale, ticketNoticeText } = await import("@/core/helpdesk/seller-texts");
      await notifyAdminsHtml(
        ctx,
        ticketNoticeText(
          await noticeLocale(ctx),
          true,
          ticket.number,
          `${PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform} · 👤 ${escapeHtml(who ?? customer.userKey)}`,
          escapeHtml(subject.slice(0, 1000)),
        ),
        { kind: "question" },
      ).catch(() => 0);
    }
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
