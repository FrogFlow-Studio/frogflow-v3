// Вопросы менеджеру, нерабочие часы, прайс по фото и ответ консультанта.
import { adminRecipients } from "@/core/notify/recipients";
import { offHoursHtml } from "../screens";
import { cleanWorkHours, outsideWorkHours } from "@/core/bot-texts/registry";
import { makeReason } from "@/core/chat/reason";
import type { TelegramMessage } from "../types";
import { escapeHtml } from "../copy";
import { setState } from "@/core/customers/customers";
import { notifyAdminsHtml } from "../notify";
import { type Bot, send, sendMain } from "./bot";
import { downloadTelegramFile } from "./payments";

/**
 * Консультант без товаров не ответил (выключен продавцом, нет ключа ИИ): вопрос
 * уходит продавцу в Telegram, покупателю — «передам менеджеру» и меню без каталога.
 */
export async function questionToManager(b: Bot, text: string) {
  const { handoffReply, unansweredQuestionTitle } = await import("@/core/consultant/messages");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const title = unansweredQuestionTitle(await sellerLocale(b.ctx).catch(() => "ru" as const));
  const who =
    [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ") ||
    (b.customer.username ? `@${b.customer.username}` : `id ${b.customer.telegramId}`);
  await notifyAdminsHtml(
    b.ctx,
    [
      `🙋 <b>${escapeHtml(title)}</b>`,
      `👤 ${escapeHtml(who)}${b.customer.username ? ` · @${escapeHtml(b.customer.username)}` : ""}`,
      `💬 ${escapeHtml(text.slice(0, 1000))}`,
    ].join("\n"),
    { kind: "question" },
  ).catch(() => 0);
  await sendMain(b, escapeHtml(handoffReply(b.locale)));
}

/** Не чаще раза в 6 часов одному покупателю: «вне часов работы» не должно сыпаться на каждую реплику. */
const OFF_HOURS_REPEAT_MS = 6 * 3_600_000;

/**
 * Текст «вне часов работы»: только если продавец задал рабочие часы и сейчас
 * вне них. Отметка ставится до отправки: повтор события не пошлёт второй раз.
 */
export async function offHoursReply(b: Bot) {
  const tenant = b.ctx.tenant;
  const hours = cleanWorkHours(tenant.settings.work_hours);
  if (!hours || !outsideWorkHours(tenant, new Date(), b.ctx.timezone)) return;
  const last = Date.parse(String(b.customer.state.off_hours_at ?? ""));
  if (Number.isFinite(last) && Date.now() - last < OFF_HOURS_REPEAT_MS) return;
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    off_hours_at: new Date().toISOString(),
  });
  await send(b, offHoursHtml(tenant, b.locale, hours));
}

/** Фото покупателя с подписью или без — консультанту по прайсу картинкой. */
export async function pricelistPhoto(b: Bot, msg: TelegramMessage): Promise<boolean> {
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(b.ctx.tenant)) return false;
  const fileId = msg.photo![msg.photo!.length - 1]!.file_id;
  const file = await downloadTelegramFile(b.api, fileId);
  const { imageFromBytes } = await import("@/core/consultant/pricelist/images");
  const image = file ? imageFromBytes(file.bytes) : null;
  return consultantReply(b, msg.caption?.trim() ?? "", {
    images: image ? [image] : [],
    messageId: msg.message_id,
    date: msg.date,
  });
}

/**
 * ИИ-консультант на свободный текст: отвечает по профилю, базе знаний и
 * каталогу; при передаче менеджеру — уведомление продавцу и пауза, чтобы
 * дальше отвечал человек (в /admin/chat диалог помечается «вы в чате»).
 */
export async function consultantReply(
  b: Bot,
  text: string,
  opts: {
    images?: import("@/core/consultant/pricelist/images").V2Image[];
    /** message_id входящего — ключ строки журнала ответов (повтор доставки её не плодит). */
    messageId?: number;
    /** Когда покупатель написал (секунды Unix): старое сообщение консультант не отвечает. */
    date?: number;
  } = {},
): Promise<boolean> {
  const { consultantEnabled, isPaused, runConsultant } =
    await import("@/core/consultant/engine.server");
  const { pauseHours, pauseNoticeRu } = await import("@/core/consultant/pause");
  const { recordConsultantRun } = await import("@/core/consultant/runs");
  const images = opts.images;
  // Журнал ответов консультанта (core/consultant/runs), как в Direct.
  const run = {
    messageId: opts.messageId != null ? `tg:${b.chatId}:${opts.messageId}` : "",
    conversationId: String(b.chatId),
    userKey: b.customer.userKey,
    source: "webhook" as const,
    incomingText: text,
  };
  if (!(await consultantEnabled(b.ctx))) return false;
  if (isPaused(b.customer)) {
    // Менеджер ведёт диалог — бот молчит; в журнал — ход без ответа.
    await recordConsultantRun(b.ctx, { ...run, replyKind: "paused", status: "cancelled" });
    return true;
  }
  await b.api.call("sendChatAction", { chat_id: b.chatId, action: "typing" });
  const r = await runConsultant(b.ctx, b.customer, text, {
    platform: "telegram",
    ...(images ? { images } : {}),
    messageId: run.messageId || null,
    sentAt: opts.date && opts.date > 0 ? new Date(opts.date * 1000).toISOString() : null,
  });
  if (!r) return false;
  // Ответа нет: сообщение вошло в соседний ход или устарело (core/consultant/burst).
  if (r.skipped) {
    await recordConsultantRun(b.ctx, { ...run, replyKind: r.skipped, status: "cancelled" });
    return true;
  }
  const sent = await b.api.call("sendMessage", { chat_id: b.chatId, text: r.reply });
  await recordConsultantRun(b.ctx, {
    ...run,
    replyText: r.reply,
    replyKind: r.handoff ? `handoff:${r.handoff.reason}` : "reply",
    model: r.model ?? null,
    usage: r.usage,
    rate: r.rate ?? null,
    tools: r.tools,
    ...(sent.ok ? {} : { status: "terminal_failed" as const, errorCode: "send_failed" }),
  });
  // Фото и видео товара (консультант по прайсу) — следом, по ссылке /api/img.
  for (const a of r.attachments ?? [])
    await b.api
      .call(a.kind === "video" ? "sendVideo" : "sendPhoto", {
        chat_id: b.chatId,
        [a.kind === "video" ? "video" : "photo"]: a.url,
      })
      .catch(() => null);
  if (b.ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(b.ctx, {
      telegramId: b.customer.telegramId,
      direction: "out",
      sender: "bot",
      text: r.reply,
      reason: makeReason({ source: "consultant", handoff: r.handoff ? true : undefined }),
    });
  }
  if (r.handoff) {
    if (b.ctx.tenant.modules.manager_chat) {
      const { connect } = await import("@/core/chat/chat");
      await connect(b.ctx, b.customer.telegramId).catch(() => {});
    }
    const { leadFromHandoff } = await import("@/core/pipeline/sources");
    await leadFromHandoff(b.ctx, b.customer, r.handoff);
    // Задача консультанта в админке (консультант по прайсу) — до уведомления.
    const { taskFromHandoff, telegramDialogLink } = await import("@/core/consultant/tasks");
    const { conversationProductLines } =
      await import("@/core/consultant/pricelist/handoff-products");
    await taskFromHandoff(b.ctx, b.customer, r.handoff, {
      channel: "telegram",
      products: await conversationProductLines(b.ctx, b.customer),
      link: telegramDialogLink(b.customer.username),
      sourceId: run.messageId || null,
    });
    const who =
      [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ") ||
      (b.customer.username ? `@${b.customer.username}` : `id ${b.customer.telegramId}`);
    const lines = [
      r.handoff.kind === "lead"
        ? `📝 <b>Заявка от ИИ-консультанта</b> (${escapeHtml(r.handoff.reason)})`
        : `🙋 <b>Клиент ждёт менеджера</b> (${escapeHtml(r.handoff.reason)})`,
      `👤 ${escapeHtml(who)}${b.customer.username ? ` · @${escapeHtml(b.customer.username)}` : ""}`,
      r.handoff.customerName ? `Имя: ${escapeHtml(r.handoff.customerName)}` : "",
      r.handoff.customerContact ? `📞 ${escapeHtml(r.handoff.customerContact)}` : "",
      `📋 ${escapeHtml(r.handoff.summary)}`,
      "",
      `Ответьте клиенту в разделе «Чат» панели — консультант в этом диалоге ${pauseNoticeRu(pauseHours(b.ctx.tenant))}.`,
    ].filter((l) => l !== "");
    // Один недоступный админ (заблокировал бота, обрыв) не мешает остальным.
    for (const chatId of await adminRecipients(b.ctx))
      await b.api
        .call("sendMessage", {
          chat_id: chatId,
          text: lines.join("\n"),
          parse_mode: "HTML",
        })
        .catch((e: unknown) => {
          console.error(`[tg:${b.ctx.tenant.id}] передача менеджеру не ушла ${chatId}`, e);
          return null;
        });
    // Передача из-за долгого сбоя ИИ (деньги, ключ) — продавцу отдельно, раз в три часа.
    const { alertSellerModelFailure } = await import("@/core/consultant/model-alert.server");
    await alertSellerModelFailure(b.ctx, (html) =>
      notifyAdminsHtml(b.ctx, html, { kind: "consultant_model" }),
    );
  }
  return true;
}
