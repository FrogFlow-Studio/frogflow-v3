import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import { SEARCH_MIN } from "@/core/chat/search";

/**
 * Админка продавца: переписка с покупателями: входящие, сообщения, счета.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const uuid = z.string().uuid();

/* ── чат с менеджером ────────────────────────────────────────────── */

/** Читать чат может любая роль; подключаться и писать покупателю — менеджер и владелец. */
const chatModule = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("manager_chat", min);

// Покупатели из Instagram/WhatsApp живут под синтетическим отрицательным
// telegram_id (core/customers), поэтому «положительный» здесь не годится.
const tgId = z
  .number()
  .int()
  .refine((n) => n !== 0, "telegram_id не может быть нулём");

const inboxFilterSchema = z.object({
  status: z.enum(["open", "closed", "all"]),
  who: z.enum(["mine", "none", "all"]),
  channel: z.enum(["telegram", "instagram", "whatsapp", "all"]),
  unread: z.boolean().optional(),
  search: z.string().max(100).optional(),
});

const DEFAULT_INBOX_FILTER = { status: "open", who: "all", channel: "all" } as const;

// Граница идёт в or() PostgREST — только строгие форматы.
const isoTime = z.string().datetime({ offset: true });

const conversationCursor = z.object({
  last_message_at: isoTime,
  telegram_id: tgId,
});

/**
 * Единый входящий: первая страница диалогов (по умолчанию открытые) со счётчиками
 * и всем, что страница знает о магазине: команда, быстрые ответы, срок «без ответа».
 */
export const chatConversationsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ filter: inboxFilterSchema.optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const inbox = await import("@/core/inbox/inbox");
    const { listInboxPage, inboxTotals } = await import("@/core/inbox/page");
    const { getSetting } = await import("@/core/settings/settings");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const { UNANSWERED_KEY, UNANSWERED_ESCALATE_KEY, parseUnansweredMinutes, parseEscalate } =
      await import("@/core/chat/unanswered");
    const me = (await adminIdentity())?.username ?? "";
    const filter = data.filter ?? DEFAULT_INBOX_FILTER;
    // Граница опроса берётся до чтения, с запасом на расхождение часов приложения и базы.
    const asOf = new Date(Date.now() - 60_000).toISOString();
    const [page, totals, rawReplies, rawUnanswered, rawEscalate] = await Promise.all([
      listInboxPage(ctx, { filter, me }),
      inboxTotals(ctx, me),
      getSetting(ctx, inbox.QUICK_REPLIES_KEY),
      getSetting(ctx, UNANSWERED_KEY),
      getSetting(ctx, UNANSWERED_ESCALATE_KEY),
    ]);
    return {
      conversations: page.items,
      hasMore: page.hasMore,
      next: page.next,
      totals,
      asOf,
      me,
      assignees: inbox.inboxAssignees(ctx),
      quickReplies: inbox.parseQuickReplies(rawReplies),
      unansweredMinutes: parseUnansweredMinutes(rawUnanswered),
      unansweredEscalate: parseEscalate(rawEscalate),
    };
  });

/** Следующая (или первая под новый фильтр/поиск) страница списка диалогов и счётчики. */
export const chatInboxPageFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ filter: inboxFilterSchema, before: conversationCursor.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listInboxPage, inboxTotals } = await import("@/core/inbox/page");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const me = (await adminIdentity())?.username ?? "";
    const [page, totals] = await Promise.all([
      listInboxPage(ctx, { filter: data.filter, me, before: data.before }),
      inboxTotals(ctx, me),
    ]);
    return { conversations: page.items, hasMore: page.hasMore, next: page.next, totals };
  });

/** Поиск по тексту переписки: находки страницами, свежие сверху. Ничего не отмечает прочитанным. */
export const chatSearchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().trim().min(SEARCH_MIN).max(100),
        // Граница идёт в or() PostgREST — только строгие форматы.
        before: z.object({ created_at: isoTime, id: z.string().uuid() }).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { searchMessages } = await import("@/core/chat/search");
    return searchMessages(ctx, data.q, { before: data.before });
  });

/** Боковая панель диалога: заказы, сумма покупок, баллы и обращения покупателя. Контактов нет. */
export const chatCustomerPanelFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { customerPanel } = await import("@/core/customers/panel");
    return customerPanel(ctx, data.telegramId);
  });

/**
 * Опрос: диалоги, менявшиеся с `since` (новая реплика, статус, ответственный),
 * счётчики и открытый в окне диалог (`selected`: его пауза бота и «вы в чате»
 * меняются без новых реплик). `unread` — сколько непрочитанных клиент знал в
 * прошлый раз: если число сдвинулось, приходит список диалогов с непрочитанным
 * (`unreadIds`), чтобы снять отметку у тех, кого прочитал коллега. `asOf` — граница
 * для следующего опроса (с запасом на расхождение часов приложения и базы).
 */
export const chatInboxPollFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        since: isoTime,
        selectedId: tgId.optional(),
        unread: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listInboxChanged, inboxTotals, getInboxItem } = await import("@/core/inbox/page");
    const { listUnreadIds } = await import("@/core/chat/chat");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const me = (await adminIdentity())?.username ?? "";
    const asOf = new Date(Date.now() - 60_000).toISOString();
    const [changed, totals, selected] = await Promise.all([
      listInboxChanged(ctx, data.since),
      inboxTotals(ctx, me),
      data.selectedId === undefined ? null : getInboxItem(ctx, data.selectedId),
    ]);
    const unreadIds =
      data.unread !== undefined && data.unread !== totals.unread ? await listUnreadIds(ctx) : null;
    return { changed, totals, selected, asOf, unreadIds };
  });

/**
 * Быстрый ответ с подстановками ({name}, {order}, {ticket}) для выбранного
 * покупателя — одно место для «Чата» и «Обращений». Только читает: ничего не отправляет.
 */
export const quickReplyFillFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        text: z.string().max(2000),
        ticketNo: z.number().int().positive().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { quickReplyVars, fillQuickReply } = await import("@/core/inbox/inbox");
    return {
      text: fillQuickReply(data.text, await quickReplyVars(ctx, data.telegramId, data.ticketNo)),
    };
  });

/**
 * Через сколько минут без ответа напомнить продавцу; 0 — не напоминать.
 * `escalate` — второй шаг владельцу; без поля настройка второго шага не меняется.
 */
export const chatUnansweredSaveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ minutes: z.number().int().min(0).max(1440), escalate: z.boolean().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { UNANSWERED_KEY, UNANSWERED_ESCALATE_KEY, parseUnansweredMinutes } =
      await import("@/core/chat/unanswered");
    const minutes = parseUnansweredMinutes(String(data.minutes));
    const { setSetting } = await import("@/core/settings/settings");
    await setSetting(ctx, UNANSWERED_KEY, String(minutes));
    if (data.escalate !== undefined)
      await setSetting(ctx, UNANSWERED_ESCALATE_KEY, data.escalate ? "1" : "0");
    return { minutes, escalate: data.escalate };
  });

export const inboxSetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        status: z.enum(["open", "closed"]).optional(),
        assignee: z.string().max(40).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { adminActor } = await import("@/app/auth/guards.server");
    const { setInboxMeta, inboxAssignees } = await import("@/core/inbox/inbox");
    if (data.assignee && !inboxAssignees(ctx).some((a) => a.username === data.assignee))
      throw new UserError("err.admin.inboxAssignee", "Такого пользователя нет в команде магазина.");
    const meta = await setInboxMeta(
      ctx,
      data.telegramId,
      { status: data.status, assignee: data.assignee },
      await adminActor(),
    );
    return { status: meta.status, assignee: meta.assignee };
  });

export const quickRepliesSaveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        replies: z
          .array(z.object({ title: z.string().max(200), text: z.string().max(4000) }))
          .max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { cleanQuickReplies, QUICK_REPLIES_KEY } = await import("@/core/inbox/inbox");
    const { setSetting } = await import("@/core/settings/settings");
    const replies = cleanQuickReplies(data.replies);
    await setSetting(ctx, QUICK_REPLIES_KEY, JSON.stringify(replies));
    return { replies, count: replies.length };
  });

export const chatMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listMessages, markRead, lastInboundAt } = await import("@/core/chat/chat");
    const [page, inboundAt] = await Promise.all([
      listMessages(ctx, data.telegramId),
      lastInboundAt(ctx, data.telegramId),
    ]);
    await markRead(ctx, data.telegramId);
    // Окно 24 часа Instagram/WhatsApp считается от последнего входящего, отдельным
    // запросом: в последней странице переписки его может не оказаться.
    // serverNow — остаток окна браузер считает по часам сервера, не по своим.
    // Шаблон WhatsApp для ответа вне окна: поле ответа заранее говорит, уйдёт ли сообщение.
    const { getSetting } = await import("@/core/settings/settings");
    const { parseNotifyTemplate } = await import("@/channels/zernio/outbox.server");
    const template = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    return {
      messages: page.messages,
      hasMore: page.hasMore,
      lastInboundAt: inboundAt,
      serverNow: new Date().toISOString(),
      waTemplate: template?.name ?? null,
    };
  });

/** «Показать раньше»: страница переписки до указанного сообщения; прочитанным не отмечает. */
export const chatEarlierFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        // Граница идёт в or() PostgREST — только строгие форматы.
        before: z.object({
          created_at: z.string().datetime({ offset: true }),
          id: z.string().uuid(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listMessages } = await import("@/core/chat/chat");
    return listMessages(ctx, data.telegramId, { before: data.before });
  });

/**
 * Товары для счёта из диалога: поиск по названию, по 30 штук — у крупного
 * магазина каталог в тысячи позиций, и список целиком форме не нужен.
 */
export const invoiceProductsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().max(100).default("") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    let q = ctx.db
      .from("products")
      .select(
        "id, name, price, currency, fulfillment_kind, product_variants(id, name, price, sort_order)",
      )
      .eq("is_active", true);
    const term = data.q.trim().replace(/[%_,()]/g, " ");
    if (term) q = q.ilike("name", `%${term}%`);
    const { data: rows, error } = await q.order("sort_order").order("name").limit(INVOICE_PAGE);
    if (error) throw serverFailure(error.message);
    return (rows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      currency: p.currency,
      physical: p.fulfillment_kind === "physical",
      variants: [...(p.product_variants ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ id: v.id, name: v.name, price: Number(v.price) })),
    }));
  });

const INVOICE_PAGE = 30;

/** Сколько позиций уже в корзине покупателя — продавца предупреждаем до замены. */
export const invoiceCartFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { count, error: countError } = await ctx.db
      .from("cart_items")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", data.telegramId);
    if (countError) throw serverFailure(`Админка: ${countError.message}`);
    return { count: count ?? 0 };
  });

/**
 * Можно ли выставить счёт в каждом канале и как (app/admin/invoice.server):
 * кнопкой в канале, ссылкой на страницу заказа на сайте или никак. Есть ли у
 * магазина адрес витрины — для подсказки, как включить оплату на сайте.
 */
export const chatInvoiceModesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async () => {
    const ctx = await chatModule("manager");
    const { invoiceMode } = await import("./invoice.server");
    return {
      telegram: await invoiceMode(ctx, "telegram"),
      instagram: await invoiceMode(ctx, "instagram"),
      whatsapp: await invoiceMode(ctx, "whatsapp"),
      storefront: Boolean(ctx.tenant.settings.slug),
    };
  });

/** «Выставить счёт»: корзина покупателю и кнопка «Оформить заказ» (или ссылка на оплату на сайте) в его канал. */
export const chatInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        items: z
          .array(
            z.object({
              productId: uuid,
              variantId: uuid.nullable(),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1)
          .max(20),
        /** true — дописать к корзине покупателя, false — заменить её счётом. */
        append: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { sendDialogInvoice } = await import("./invoice.server");
    return sendDialogInvoice(ctx, data.telegramId, data.items, { append: data.append });
  });

/** Консультант снова отвечает в диалоге, не дожидаясь конца паузы. */
export const chatResumeBotFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const c = await getCustomerByTelegramId(ctx, data.telegramId);
    if (c) await (await import("@/core/consultant/engine.server")).resumeConsultant(ctx, c);
    return { ok: true };
  });

export const chatConnectFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ telegramId: tgId, active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const chat = await import("@/core/chat/chat");
    if (data.active) await chat.connect(ctx, data.telegramId);
    else {
      await chat.disconnect(ctx, data.telegramId);
      // Вернули боту — консультант снова отвечает этому покупателю.
      const { getCustomerByTelegramId } = await import("@/core/customers/customers");
      const c = await getCustomerByTelegramId(ctx, data.telegramId);
      if (c) await (await import("@/core/consultant/engine.server")).resumeConsultant(ctx, c);
    }
    return { ok: true };
  });

export const chatReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        text: z.string().trim().max(4000),
        // Фото или документ, уже загруженные через /api/admin/upload.
        attachment: z
          .object({
            kind: z.enum(["photo", "file"]),
            key: z.string().min(1).max(200),
            name: z.string().max(255).default(""),
          })
          .optional(),
        draftId: z.string().uuid().optional(),
      })
      .refine((v) => v.text.length > 0 || v.attachment, { message: "empty reply" })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { replyAsManager, pauseBotAfterManagerReply } = await import("./admin.server");
    await replyAsManager(ctx, data.telegramId, data.text, data.attachment, data.draftId);
    // Ответил человек — консультант не перебивает его на выбранное продавцом время.
    await pauseBotAfterManagerReply(ctx, data.telegramId);
    // Ничей диалог достаётся тому, кто ответил первым.
    const { adminIdentity, adminActor } = await import("@/app/auth/guards.server");
    const inbox = await import("@/core/inbox/inbox");
    const me = await adminIdentity();
    if (me) await inbox.claimOnReply(ctx, data.telegramId, me.username, await adminActor());
    return { ok: true };
  });
