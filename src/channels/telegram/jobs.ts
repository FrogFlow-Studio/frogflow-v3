/**
 * Фоновые задачи Telegram-канала: рассылка пакетами, напоминание о брошенной
 * корзине, напоминание о дате получения. Крон в /api/cron/* обходит всех
 * клиентов v2 и зовёт эти функции по одному арендатору; правила — в ядре,
 * здесь только отправка.
 */
import { env } from "@/config/env";
import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { imageUrl } from "@/core/catalog/catalog";
import { notifyAdminsHtml } from "./notify";
import {
  processBroadcastBatch,
  textForLocale,
  type AudienceFilter,
  type BatchResult,
  type BroadcastSender,
} from "@/core/broadcasts/broadcasts";
import { buttonLabel, type BroadcastContent } from "@/core/broadcasts/pure";
import { clickMark } from "@/core/broadcasts/clicks";
import { sendCartReminders } from "@/core/reminders/cart";
import { sendFulfillmentReminders } from "@/core/reminders/fulfillment";
import { telegramApi, type TelegramApi } from "./api";
import { COPY, cartReminderBody, escapeHtml } from "./copy";
import { inChunks } from "@/lib/in-chunks";
import { buyerLocale, isLocale, type Locale } from "@/core/i18n/locale";
import { waitedText } from "@/core/helpdesk/seller-texts";
import { formatMoney } from "@/core/money/money";

function api(ctx: TenantContext): TelegramApi {
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

type InlineButton = { text: string; callback_data: string };

async function broadcastKeyboard(
  ctx: TenantContext,
  content: BroadcastContent,
  mark: string,
  locale: Locale = ctx.tenant.settings.default_locale ?? "ru",
): Promise<{ inline_keyboard: InlineButton[][] }> {
  const rows: InlineButton[][] = [];
  if (content.productIds.length > 0) {
    const data = await inChunks(
      content.productIds,
      (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).eq("is_active", true),
      "[telegram] товары рассылки не прочитаны",
    );
    const byId = new Map(data.map((p) => [p.id, p.name]));
    for (const id of content.productIds) {
      const name = byId.get(id);
      if (name)
        rows.push([{ text: `📖 ${buttonLabel(name)}`, callback_data: `prod:${id}:${mark}` }]);
    }
  }
  if (content.showCatalog)
    rows.push([{ text: COPY[locale].openCatalogBtn, callback_data: `cat:root:0:${mark}` }]);
  // Отписка — под каждой рассылкой (handle-update: callback "unsub").
  rows.push([{ text: COPY[locale].unsubscribeBtn, callback_data: "unsub" }]);
  return { inline_keyboard: rows };
}

/**
 * Отправитель одного сообщения рассылки. Фото уходят ссылками на этот же
 * деплой (/api/img/…): Telegram скачивает их сам, без multipart. Текст до
 * 1024 символов едет подписью к первому фото, длиннее — отдельным сообщением.
 */
export function telegramBroadcastSender(ctx: TenantContext, tg: TelegramApi): BroadcastSender {
  const cache = new Map<string, Awaited<ReturnType<typeof broadcastKeyboard>>>();
  // Метка рассылки в кнопках — для счёта кликов (core/broadcasts/clicks).
  const keyboardFor = async (c: BroadcastContent, broadcastId: string, locale?: Locale) => {
    const mark = clickMark(broadcastId);
    const key = `${mark}|${c.productIds.join(",")}|${c.showCatalog}|${locale ?? ""}`;
    if (!cache.has(key)) cache.set(key, await broadcastKeyboard(ctx, c, mark, locale));
    return cache.get(key);
  };
  // Язык получателя — только для рассылок с текстами по языкам (акции): обычным лишний запрос не нужен.
  const localeOf = async (telegramId: number): Promise<Locale | undefined> => {
    const { data, error } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (error) {
      // Не прочитали язык — шлём на языке магазина, лучше, чем потерять сообщение.
      console.warn(`[telegram] язык получателя рассылки: ${error.message}`);
      return undefined;
    }
    const l = (data?.state as { locale?: unknown } | null)?.locale;
    return isLocale(l) ? l : undefined;
  };
  const fail = (r: { ok: boolean; description?: string }, method: string) => {
    if (!r.ok) throw new Error(r.description || `${method} failed`);
  };

  return async (recipient, content, broadcast) => {
    const chatId = recipient.telegramId;
    const localized = Boolean((broadcast.audience_filter as AudienceFilter | null)?.texts);
    const locale = localized ? await localeOf(chatId) : undefined;
    const reply_markup = await keyboardFor(content, broadcast.id, locale);
    const photos = content.photoKeys.map((k) => imageUrl(ctx, k));
    const text = localized ? textForLocale(broadcast, locale) : content.text;
    const asCaption = text.length > 0 && text.length <= 1024;

    if (photos.length === 0) {
      fail(
        await tg.call("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup,
        }),
        "sendMessage",
      );
      return;
    }

    if (text && !asCaption)
      fail(
        await tg.call("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        "sendMessage",
      );

    if (photos.length === 1) {
      fail(
        await tg.call("sendPhoto", {
          chat_id: chatId,
          photo: photos[0],
          ...(asCaption ? { caption: text, parse_mode: "HTML" } : {}),
          reply_markup,
        }),
        "sendPhoto",
      );
      return;
    }

    fail(
      await tg.call("sendMediaGroup", {
        chat_id: chatId,
        media: photos.map((url, i) => ({
          type: "photo",
          media: url,
          ...(i === 0 && asCaption ? { caption: text, parse_mode: "HTML" } : {}),
        })),
      }),
      "sendMediaGroup",
    );
    // У альбома кнопок нет: они — отдельным сообщением следом.
    const m = COPY[locale ?? ctx.tenant.settings.default_locale ?? "ru"];
    const onlyUnsub = content.productIds.length === 0 && !content.showCatalog;
    fail(
      await tg.call("sendMessage", {
        chat_id: chatId,
        text: onlyUnsub ? m.unsubscribeHint : m.broadcastPick,
        reply_markup,
      }),
      "sendMessage",
    );
  };
}

export async function runBroadcastBatch(
  tenant: Tenant,
): Promise<BatchResult | { skipped: string }> {
  if (!tenant.modules.broadcasts) return { skipped: "module off" };
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  return processBroadcastBatch(ctx, telegramBroadcastSender(ctx, api(ctx)));
}

/** Минутная сетка: убрать из чатов продавцов уведомления о решённых заказах. */
export async function flushOrderNotify(tenant: Tenant) {
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  const { flushDueOrderNotify } = await import("./order-notify");
  return { dismissed: await flushDueOrderNotify(ctx, api(ctx)) };
}

/**
 * Напоминание о корзине: Telegram — сообщением с кнопками, Instagram/WhatsApp —
 * в диалог Zernio (ядро присылает только тех, у кого открыто окно ответа).
 * Текст называет до трёх позиций и сумму (core/reminders/cart).
 */
export async function runCartReminders(tenant: Tenant) {
  if (!tenant.modules.cart_reminder) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return sendCartReminders(ctx, async (r) => {
    const m = COPY[r.locale];
    const text = cartReminderBody(
      r.locale,
      r.lines,
      r.more,
      r.total ? formatMoney(r.total.amount, r.total.currency) : null,
    );
    if (r.customer.platform === "telegram") {
      if (!tg) return false;
      const sent = await tg.call("sendMessage", {
        chat_id: r.telegramId,
        text,
        reply_markup: {
          inline_keyboard: [
            [{ text: m.openCartBtn, callback_data: "cart:show" }],
            [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
          ],
        },
      });
      return sent.ok;
    }
    const target = zernioTargetOf(r.customer, ctx.tenant.settings.default_locale);
    return target ? sendToZernioTarget(target, text) : false;
  });
}

export async function runFulfillmentReminders(tenant: Tenant) {
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  const tg = api(ctx);
  return sendFulfillmentReminders(ctx, async (r) => {
    if (r.platform === "telegram")
      await tg.call("sendMessage", {
        chat_id: r.telegramId,
        text: COPY[r.locale].fulfillmentReminder(r.displayNo, r.dateLabel),
      });
    const typeLabel = r.type === "delivery" ? "Доставка" : "Самовывоз";
    const address = r.address ? `\n📍 ${escapeHtml(r.address)}` : "";
    const load = r.load
      ? `\n📊 Заказов на день: ${r.load.total}${r.load.dayLimit !== null ? ` из ${r.load.dayLimit}` : ""}` +
        (r.load.slotCount !== null
          ? `; на это время: ${r.load.slotCount}${r.load.slotLimit !== null ? ` из ${r.load.slotLimit}` : ""}`
          : "")
      : "";
    const text = `⏰ Завтра (${r.dateLabel}) — заказ #${r.displayNo}. ${typeLabel}.${address}${load}`;
    await notifyAdminsHtml(ctx, text, { kind: "fulfillment", orderId: r.orderId });
  });
}

/**
 * Возвратные продажи (модуль winback): Telegram — сообщением с кнопкой в
 * каталог; Instagram/WhatsApp — в диалог Zernio (вне 24-часового окна Meta
 * откажет, это честный «не доставлено»).
 */
export async function runWinbackFor(tenant: Tenant) {
  if (!tenant.modules.winback) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { runWinback } = await import("@/core/winback/winback");
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return runWinback(ctx, async (c, text) => {
    if (c.platform === "telegram") {
      if (!tg) return false;
      const m = COPY[buyerLocale(c.state, ctx.tenant.settings.default_locale)];
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: m.catalog, callback_data: "cat:root" }],
            [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
          ],
        },
      });
      return r.ok;
    }
    const target = zernioTargetOf(c);
    return target ? sendToZernioTarget(target, text) : false;
  });
}

/**
 * «Похожие материалы» (модуль winback): через N дней после покупки — до трёх
 * товаров из тех же категорий кнопками. Только Telegram, через бота магазина.
 */
export async function runSimilarFor(tenant: Tenant) {
  if (!tenant.modules.winback) return { skipped: "module off" };
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  const { runSimilar } = await import("@/core/similar/similar");
  const tg = api(ctx);
  return runSimilar(ctx, async (to, text, products) => {
    const r = await tg.call("sendMessage", {
      chat_id: to.telegramId,
      text: escapeHtml(text),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: products.map((p) => [
          { text: `📖 ${buttonLabel(p.name)}`, callback_data: `prod:${p.id}` },
        ]),
      },
    });
    return r.ok;
  });
}

/**
 * Просьба об оценке после выдачи (модуль review_request): Telegram — кнопками
 * оценки, Instagram и WhatsApp — обычным текстом, ответ цифрой (core/reviews/ask).
 */
export async function runReviewAskFor(tenant: Tenant) {
  if (!tenant.modules.review_request) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { runReviewAsk } = await import("@/core/reviews/ask");
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return runReviewAsk(ctx, async (c, ask) => {
    const m = COPY[buyerLocale(c.state, ctx.tenant.settings.default_locale)];
    if (c.platform === "telegram") {
      if (!tg) return false;
      const first = ask.products[0]!;
      const single = ask.products.length === 1;
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: single
          ? m.reviewAskOne(escapeHtml(first.name))
          : m.reviewAskOrder(String(ask.orderNo)),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            single
              ? [1, 2, 3, 4, 5].map((n) => ({
                  text: "⭐".repeat(n),
                  callback_data: `stars:${first.id}:${n}`,
                }))
              : [{ text: m.rateBtn(String(ask.orderNo)), callback_data: `rate:${ask.orderId}` }],
            [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
          ],
        },
      });
      return r.ok;
    }
    const target = zernioTargetOf(c);
    return target ? sendToZernioTarget(target, m.reviewAskDirect(ask.products[0]!.name)) : false;
  });
}

/** Автоворонка (модуль funnel): те же каналы, что у возвратных продаж. */
export async function runFunnelFor(tenant: Tenant) {
  if (!tenant.modules.funnel) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { runFunnel } = await import("@/core/funnel/funnel");
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return runFunnel(ctx, async (c, text, catalogButton) => {
    if (c.platform === "telegram") {
      if (!tg) return false;
      const m = COPY[buyerLocale(c.state, ctx.tenant.settings.default_locale)];
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            ...(catalogButton ? [[{ text: m.catalog, callback_data: "cat:root" }]] : []),
            [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
          ],
        },
      });
      return r.ok;
    }
    const target = zernioTargetOf(c);
    return target ? sendToZernioTarget(target, text) : false;
  });
}

/**
 * «Акция кончается завтра» (core/offers/remind): тем, кому ушло сообщение
 * «Позвать покупателей», — одно напоминание на языке покупателя с кнопкой в
 * каталог и отпиской. Недоставленное не повторяется.
 */
export async function runSaleReminders(tenant: Tenant) {
  if (!tenant.modules.limited_offers) return { skipped: "module off" };
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  const tg = api(ctx);
  const { runOfferReminders } = await import("@/core/offers/remind");
  return runOfferReminders(ctx, async ({ telegramId, locale, text }) => {
    const m = COPY[locale] ?? COPY.ru;
    const r = await tg.call("sendMessage", {
      chat_id: telegramId,
      text: escapeHtml(text),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: m.catalog, callback_data: "cat:root" }],
          [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
        ],
      },
    });
    return r.ok;
  });
}

/** Поздравления с днём рождения (core/funnel/birthday) — в канал покупателя. */
export async function runBirthdaysFor(tenant: Tenant) {
  if (!tenant.modules.funnel) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { runBirthdays } = await import("@/core/funnel/birthday");
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return runBirthdays(ctx, async (c, text) => {
    if (c.platform === "telegram") {
      if (!tg) return false;
      const m = COPY[buyerLocale(c.state, ctx.tenant.settings.default_locale)];
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: m.catalog, callback_data: "cat:root" }],
            [{ text: m.unsubscribeBtn, callback_data: "unsub" }],
          ],
        },
      });
      return r.ok;
    }
    const target = zernioTargetOf(c);
    return target ? sendToZernioTarget(target, text) : false;
  });
}

/**
 * Товары-подписки (core/catalog/subscription): напоминание продлить. Telegram
 * — кнопки «Продлить» (товар в корзину и оформление) и «Отменить подписку»;
 * Instagram/WhatsApp — ссылка на товар на витрине или «напишите нам»; заказ с
 * сайта без Telegram — письмом со ссылкой на товар.
 */
export async function runSubscriptionsFor(tenant: Tenant) {
  if (!tenant.modules.subscriptions) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { runSubscriptionRenewals, renewalText } = await import("@/core/catalog/subscription");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const slug = tenant.settings.slug;
  const productUrl = (id: string) =>
    slug && storefrontOpen(tenant, "catalog")
      ? `${ctx.appUrl}/s/${encodeURIComponent(slug)}/p/${id}`
      : null;
  const tg = tenant.telegramTokenEnc ? api(ctx) : null;
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return runSubscriptionRenewals(ctx, async (r, c) => {
    const platform = c?.platform ?? r.order.platform;
    if (platform === "telegram" && c && tg) {
      const m = COPY[buyerLocale(c.state, ctx.tenant.settings.default_locale)];
      const res = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(renewalText(r.name, r.days, null)),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: m.renewBtn, callback_data: `subren:${r.order.id}:${r.productId}` }],
            [{ text: m.subOffBtn, callback_data: `suboff:${r.productId}` }],
          ],
        },
      });
      return res.ok;
    }
    const url = productUrl(r.productId);
    const how = url ? `Продлить: ${url}` : "Чтобы продлить, напишите нам «продлить».";
    if (c && (c.platform === "instagram" || c.platform === "whatsapp")) {
      const target = zernioTargetOf(c);
      return target ? sendToZernioTarget(target, renewalText(r.name, r.days, how)) : false;
    }
    if (r.order.customer_email && url) {
      const { emailOrderNotice } = await import("@/core/storefront/web-notify");
      return emailOrderNotice(ctx, r.order, renewalText(r.name, r.days, how), env().SESSION_SECRET);
    }
    return false;
  });
}

/**
 * Курсы: сообщение о новом уроке по расписанию (правила — в core/courses).
 * Название урока вставляется как текст (HTML экранируется), ссылка — кнопкой.
 */
export async function runCourseLessons(tenant: Tenant) {
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  const { announceNewLessons } = await import("@/core/courses/announce.server");
  const tg = api(ctx);
  const m = COPY[ctx.tenant.settings.default_locale ?? "ru"] ?? COPY.ru;
  const { lessonAnnouncer } = await import("./lesson-opened");
  const lessons = await announceNewLessons(ctx, lessonAnnouncer(ctx));
  // Напоминания до старта, о несданном задании и конец доступа к каналу.
  const { courseReminders } = await import("@/core/courses/reminders.server");
  const { telegramChannelInviter } = await import("./courses");
  const day = new Intl.DateTimeFormat(ctx.tenant.settings.default_locale ?? "ru", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ctx.timezone,
  });
  const reminders = await courseReminders(
    ctx,
    async (x) => {
      if (x.kind === "review") {
        // Звёзды — те же кнопки, что у «Оценить заказ»: дальше работает обычный путь отзывов.
        const r = await tg.call("sendMessage", {
          chat_id: x.telegramId,
          text: escapeHtml(m.courseReviewAsk(x.course)),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [1, 2, 3, 4, 5].map((n) => ({
                text: "⭐".repeat(n),
                callback_data: `stars:${x.productId}:${n}`,
              })),
            ],
          },
        });
        return r.ok;
      }
      const text =
        x.kind === "pre"
          ? m.coursePreStart(x.course, x.days, day.format(new Date(x.start)))
          : m.courseHomeworkDue(x.course, x.lessonNo, x.title);
      const r = await tg.call("sendMessage", {
        chat_id: x.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        ...(x.url
          ? { reply_markup: { inline_keyboard: [[{ text: m.courseOpenBtn, url: x.url }]] } }
          : {}),
      });
      return r.ok;
    },
    telegramChannelInviter(tg),
  );
  return { lessons, reminders };
}

/**
 * Курсы: напоминания об эфирах потока за сутки и за час (core/courses/live-remind).
 * Язык — выбранный учеником, иначе язык магазина; название и время вставляются
 * как текст (HTML экранируется). Отправка, которая могла дойти, не повторяется.
 */
export async function runCourseLives(tenant: Tenant) {
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  const { liveReminders } = await import("@/core/courses/live-remind.server");
  const { liveReminderMessage } = await import("./live-remind-text");
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const tg = api(ctx);
  const fallback = ctx.tenant.settings.default_locale ?? "ru";
  return liveReminders(ctx, async (x) => {
    const c = await getCustomerByTelegramId(ctx, x.telegramId).catch(() => null);
    const locale = isLocale(c?.state.locale) ? c.state.locale : fallback;
    const { text, rows } = liveReminderMessage(x, locale);
    const r = await tg.call("sendMessage", {
      chat_id: x.telegramId,
      text,
      parse_mode: "HTML",
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    });
    return r.ok;
  });
}

/** «12 мин», «2 ч 5 мин» — сколько покупатель ждёт (язык продавца, по умолчанию русский). */
export function waitedLabel(since: string, now = Date.now(), locale: Locale = "ru"): string {
  return waitedText(locale, since, now);
}

/**
 * Диалог без ответа (страница «Чат», по умолчанию выключено): одно
 * сообщение продавцу на отрезок ожидания, с именем ответственного, если он
 * назначен. Своего Telegram у пользователей «Команды» нет, поэтому пишем
 * туда же, куда уведомления магазина (тихие часы и матрица — там же).
 */
export async function runUnansweredChats(tenant: Tenant) {
  if (!tenant.modules.manager_chat) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { getSettings } = await import("@/core/settings/settings");
  const {
    UNANSWERED_KEY,
    UNANSWERED_ESCALATE_KEY,
    parseEscalate,
    parseUnansweredMinutes,
    remindUnanswered,
  } = await import("@/core/chat/unanswered");
  const settings = await getSettings(ctx, [UNANSWERED_KEY, UNANSWERED_ESCALATE_KEY]);
  const minutes = parseUnansweredMinutes(settings[UNANSWERED_KEY]);
  if (!minutes) return { skipped: "off" };
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const channel: Record<string, string> = {
    telegram: "Telegram",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
  };
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const { unansweredChatText, unansweredEscalationText } =
    await import("@/core/helpdesk/seller-texts");
  const locale = await sellerLocale(ctx);
  const card = async (d: {
    telegramId: number;
    waitingSince: string;
    lastText: string;
    assignee: string | null;
  }) => {
    const c = await getCustomerByTelegramId(ctx, d.telegramId);
    const name =
      [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
      (c?.username ? `@${c.username}` : `id ${d.telegramId}`);
    const preview = d.lastText.length > 200 ? `${d.lastText.slice(0, 200)}…` : d.lastText;
    return {
      waited: waitedLabel(d.waitingSince, Date.now(), locale),
      card: {
        who: `${channel[c?.platform ?? "telegram"] ?? "Telegram"} · 👤 ${escapeHtml(name)}`,
        assignee: d.assignee ? escapeHtml(d.assignee) : null,
        preview: escapeHtml(preview),
        // Прямо в диалог: страница «Чат» открывает его по ?c= и подгружает историю.
        link: `${ctx.appUrl}/admin/chat?c=${d.telegramId}`,
      },
    };
  };
  // Второй шаг — только владельцу и только если включён; без владельца писать некому.
  const owner = ctx.tenant.ownerTelegramId;
  const escalate =
    parseEscalate(settings[UNANSWERED_ESCALATE_KEY]) && owner
      ? async (d: Parameters<typeof card>[0]) => {
          const x = await card(d);
          await notifyAdminsHtml(ctx, unansweredEscalationText(locale, x.waited, x.card), {
            kind: "question",
            recipients: [String(owner)],
          });
        }
      : undefined;
  return remindUnanswered(
    ctx,
    minutes,
    async (d) => {
      const x = await card(d);
      await notifyAdminsHtml(ctx, unansweredChatText(locale, x.waited, x.card), {
        kind: "question",
      });
    },
    new Date(),
    escalate,
  );
}

/**
 * Обращение без ответа дольше N часов (страница «Обращения», по умолчанию
 * выключено): одно сообщение продавцу на отрезок ожидания, с номером
 * обращения и ссылкой на диалог. Адресат — как у напоминаний о диалогах.
 */
export async function runOverdueTickets(tenant: Tenant) {
  if (!tenant.modules.helpdesk || !tenant.modules.manager_chat) return { skipped: "module off" };
  const ctx = tenantContext(tenant);
  const { getSetting } = await import("@/core/settings/settings");
  const { OVERDUE_KEY, parseOverdueHours, remindOverdue } = await import("@/core/helpdesk/overdue");
  const hours = parseOverdueHours(await getSetting(ctx, OVERDUE_KEY));
  if (!hours) return { skipped: "off" };
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const { overdueTicketText } = await import("@/core/helpdesk/seller-texts");
  const locale = await sellerLocale(ctx);
  return remindOverdue(ctx, hours, async ({ ticket, waitingSince }) => {
    const name = ticket.customerName ?? `id ${ticket.telegramId}`;
    const preview =
      ticket.subject.length > 200 ? `${ticket.subject.slice(0, 200)}…` : ticket.subject;
    const html = overdueTicketText(
      locale,
      ticket.number,
      waitedLabel(waitingSince, Date.now(), locale),
      {
        who: `👤 ${escapeHtml(name)}`,
        assignee: ticket.assignee ? escapeHtml(ticket.assignee) : null,
        preview: escapeHtml(preview),
        link: `${ctx.appUrl}/admin/chat?c=${ticket.telegramId}`,
      },
    );
    await notifyAdminsHtml(ctx, html, { kind: "question" });
  });
}
