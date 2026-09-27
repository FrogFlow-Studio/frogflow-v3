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
  type BatchResult,
  type BroadcastSender,
} from "@/core/broadcasts/broadcasts";
import { buttonLabel, type BroadcastContent } from "@/core/broadcasts/pure";
import { clickMark } from "@/core/broadcasts/clicks";
import { sendCartReminders } from "@/core/reminders/cart";
import { sendFulfillmentReminders } from "@/core/reminders/fulfillment";
import { telegramApi, type TelegramApi } from "./api";
import { COPY, escapeHtml } from "./copy";

function api(ctx: TenantContext): TelegramApi {
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

type InlineButton = { text: string; callback_data: string };

async function broadcastKeyboard(
  ctx: TenantContext,
  content: BroadcastContent,
  mark: string,
  locale: "ru" = "ru",
): Promise<{ inline_keyboard: InlineButton[][] } | undefined> {
  const rows: InlineButton[][] = [];
  if (content.productIds.length > 0) {
    const { data } = await ctx.db
      .from("products")
      .select("id, name")
      .in("id", content.productIds)
      .eq("is_active", true);
    const byId = new Map((data ?? []).map((p) => [p.id, p.name]));
    for (const id of content.productIds) {
      const name = byId.get(id);
      if (name)
        rows.push([{ text: `📖 ${buttonLabel(name)}`, callback_data: `prod:${id}:${mark}` }]);
    }
  }
  if (content.showCatalog)
    rows.push([{ text: COPY[locale].openCatalogBtn, callback_data: `cat:root:0:${mark}` }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/**
 * Отправитель одного сообщения рассылки. Фото уходят ссылками на этот же
 * деплой (/api/img/…): Telegram скачивает их сам, без multipart. Текст до
 * 1024 символов едет подписью к первому фото, длиннее — отдельным сообщением.
 */
export function telegramBroadcastSender(ctx: TenantContext, tg: TelegramApi): BroadcastSender {
  const cache = new Map<string, Awaited<ReturnType<typeof broadcastKeyboard>>>();
  // Метка рассылки в кнопках — для счёта кликов (core/broadcasts/clicks).
  const keyboardFor = async (c: BroadcastContent, broadcastId: string) => {
    const mark = clickMark(broadcastId);
    const key = `${mark}|${c.productIds.join(",")}|${c.showCatalog}`;
    if (!cache.has(key)) cache.set(key, await broadcastKeyboard(ctx, c, mark));
    return cache.get(key);
  };
  const fail = (r: { ok: boolean; description?: string }, method: string) => {
    if (!r.ok) throw new Error(r.description || `${method} failed`);
  };

  return async (recipient, content, broadcast) => {
    const chatId = recipient.telegramId;
    const reply_markup = await keyboardFor(content, broadcast.id);
    const photos = content.photoKeys.map((k) => imageUrl(ctx, k));
    const text = content.text;
    const asCaption = text.length > 0 && text.length <= 1024;

    if (photos.length === 0) {
      fail(
        await tg.call("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(reply_markup ? { reply_markup } : {}),
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
          ...(reply_markup ? { reply_markup } : {}),
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
    if (reply_markup)
      fail(
        await tg.call("sendMessage", {
          chat_id: chatId,
          text: COPY.ru.broadcastPick,
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

export async function runCartReminders(tenant: Tenant) {
  if (!tenant.modules.cart_reminder) return { skipped: "module off" };
  if (!tenant.telegramTokenEnc) return { skipped: "no telegram" };
  const ctx = tenantContext(tenant);
  const tg = api(ctx);
  return sendCartReminders(ctx, async ({ telegramId, locale }) => {
    const m = COPY[locale];
    const r = await tg.call("sendMessage", {
      chat_id: telegramId,
      text: m.cartReminder,
      reply_markup: { inline_keyboard: [[{ text: m.openCartBtn, callback_data: "cart:show" }]] },
    });
    return r.ok;
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
    const text = `⏰ Завтра (${r.dateLabel}) — заказ #${r.displayNo}. ${typeLabel}.${address}`;
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
      const locale = (c.state.locale as keyof typeof COPY) ?? "ru";
      const m = COPY[locale] ?? COPY.ru;
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: m.catalog, callback_data: "cat:root" }]] },
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
      const m = COPY[(c.state.locale as keyof typeof COPY) ?? "ru"] ?? COPY.ru;
      const r = await tg.call("sendMessage", {
        chat_id: c.telegramId,
        text: escapeHtml(text),
        parse_mode: "HTML",
        ...(catalogButton
          ? {
              reply_markup: { inline_keyboard: [[{ text: m.catalog, callback_data: "cat:root" }]] },
            }
          : {}),
      });
      return r.ok;
    }
    const target = zernioTargetOf(c);
    return target ? sendToZernioTarget(target, text) : false;
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
  return announceNewLessons(ctx, async (a) => {
    const r = await tg.call("sendMessage", {
      chat_id: a.telegramId,
      text: escapeHtml(m.courseNewLesson(a.lessonNo, a.title)),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: m.courseOpenBtn, url: a.url }]] },
    });
    return r.ok;
  });
}
