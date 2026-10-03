import type { TenantContext } from "@/core/tenant/resolve.server";
import { hwCommentFromReply, parseHwReplies, parseHwReplyCommand } from "@/core/courses/hw-replies";
import type { TelegramApi } from "./api";
import { escapeHtml } from "./copy";
import type { TelegramMessage } from "./types";

/**
 * Проверка домашнего задания прямо из Telegram (ниша «Онлайн-школа»):
 * преподаватель отвечает свайпом на уведомление о работе — это комментарий;
 * кнопки «Принять» / «На доработку» ставят оценку. Тот же путь, что кнопки
 * в админке (reviewAndNotify): условная запись по версии работы, сообщение
 * ученику в его канале. Жать кнопки может продавец магазина или куратор,
 * которому назначена эта работа (core/courses/curators).
 */
const say = (api: TelegramApi, chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  api.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });

async function isSeller(ctx: TenantContext, fromId: number): Promise<boolean> {
  const { shopAdminIds } = await import("@/core/notify/recipients");
  return (await shopAdminIds(ctx)).includes(String(fromId));
}

/** Куратор школы с этим Telegram-id (в любом из списков). */
async function curatorByTelegram(ctx: TenantContext, fromId: number) {
  const { parseCurators } = await import("@/core/courses/curators");
  return parseCurators(ctx.tenant.settings.curators).items.find((c) => c.telegram_id === fromId);
}

/** Продавец — любую работу; куратор — только назначенную ему. */
async function mayReview(ctx: TenantContext, fromId: number, orderItemId: string) {
  if (await isSeller(ctx, fromId)) return true;
  const me = await curatorByTelegram(ctx, fromId);
  if (!me) return false;
  const { assignedCurator } = await import("@/core/courses/curators.server");
  return (await assignedCurator(ctx, orderItemId))?.id === me.id;
}

const REPLY_COPY = {
  ru: {
    none: "Быстрых ответов пока нет: добавьте их в «Домашних заданиях» в панели.",
    list: "Быстрые ответы. Ответьте на уведомление «#номер» (можно дописать свои слова после номера):",
    missing: (n: number) => `Быстрого ответа №${n} нет. Ответьте «#» — покажу список.`,
    comment: "Комментарий:",
  },
  kk: {
    none: "Жылдам жауаптар әзірге жоқ: оларды панельдегі «Үй тапсырмалары» бөлімінде қосыңыз.",
    list: "Жылдам жауаптар. Хабарламаға «#нөмір» деп жауап беріңіз (нөмірден кейін өз сөздеріңізді қосуға болады):",
    missing: (n: number) => `№${n} жылдам жауап жоқ. «#» деп жауап беріңіз — тізімді көрсетемін.`,
    comment: "Пікір:",
  },
  en: {
    none: "No quick replies yet: add them under “Homework” in the panel.",
    list: "Quick replies. Reply to the notification with “#number” (you can add your own words after the number):",
    missing: (n: number) => `There is no quick reply #${n}. Reply “#” to see the list.`,
    comment: "Comment:",
  },
  uz: {
    none: "Tezkor javoblar hozircha yo‘q: ularni paneldagi «Uy vazifalari» bo‘limida qo‘shing.",
    list: "Tezkor javoblar. Xabarga «#raqam» deb javob bering (raqamdan keyin o‘z so‘zlaringizni qo‘shishingiz mumkin):",
    missing: (n: number) =>
      `№${n} tezkor javob yo‘q. «#» deb javob bering — ro‘yxatni ko‘rsataman.`,
    comment: "Izoh:",
  },
} as const;

/** Ответ свайпом на уведомление о работе. false — это не такой ответ. */
export async function homeworkReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  if (!ctx.tenant.modules.courses || !msg.from || !msg.message_id) return false;
  const { hwRefOf, resolveHwRef, saveHwDraft } = await import("@/core/courses/review-ref");
  const ref = hwRefOf(msg.reply_to_message?.text ?? msg.reply_to_message?.caption);
  let text = msg.text?.trim();
  if (!ref || !text) return false;
  if (!(await isSeller(ctx, msg.from.id)) && !(await curatorByTelegram(ctx, msg.from.id)))
    return false;
  const target = await resolveHwRef(ctx, ref);
  if (target && !(await mayReview(ctx, msg.from.id, target.orderItemId))) {
    await say(api, msg.chat.id, "⛔ Эта работа назначена другому куратору.");
    return true;
  }
  const { getHomework } = await import("@/core/courses/homework.server");
  const hw = target ? await getHomework(ctx, target.orderItemId, target.lessonId) : null;
  if (!hw) {
    await say(api, msg.chat.id, "Не нашёл эту работу — откройте «Домашние задания» в панели.");
    return true;
  }
  if (hw.status !== "submitted") {
    await say(api, msg.chat.id, "Эта работа уже проверена.");
    return true;
  }
  // «#» — список быстрых ответов, «#2 [слова]» — комментарий из шаблона №2.
  const cmd = parseHwReplyCommand(text);
  let fromReply = false;
  if (cmd) {
    const rc = REPLY_COPY[ctx.tenant.settings.default_locale ?? "ru"] ?? REPLY_COPY.ru;
    const replies = parseHwReplies(ctx.tenant.settings.homework_replies);
    if (cmd.kind === "list") {
      await say(
        api,
        msg.chat.id,
        replies.length
          ? [rc.list, ...replies.map((r, i) => `${i + 1}. ${escapeHtml(r.title)}`)].join("\n")
          : rc.none,
      );
      return true;
    }
    const filled = hwCommentFromReply(replies, cmd, hw.student);
    if (!filled) {
      await say(api, msg.chat.id, rc.missing(cmd.n));
      return true;
    }
    text = filled;
    fromReply = true;
  }
  if (!(await saveHwDraft(ctx, ref, msg.message_id, text))) {
    await say(api, msg.chat.id, "Не удалось сохранить комментарий — попробуйте ещё раз.");
    return true;
  }
  const tail = `${ref}:${hw.rev}:${msg.message_id}`;
  await say(
    api,
    msg.chat.id,
    `Комментарий к работе «${escapeHtml(hw.student)}» (урок ${hw.lessonNo}). Как отметить?` +
      (fromReply
        ? `\n\n<i>${(REPLY_COPY[ctx.tenant.settings.default_locale ?? "ru"] ?? REPLY_COPY.ru).comment}</i> ${escapeHtml(text.slice(0, 500))}`
        : ""),
    {
      reply_to_message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Принять", callback_data: `hwa:${tail}` },
            { text: "↩️ На доработку", callback_data: `hwv:${tail}` },
          ],
        ],
      },
    },
  );
  return true;
}

/**
 * Кнопка `hwa:<метка>:<версия>[:<id ответа>]` — принять, `hwv:…` — на
 * доработку (только с комментарием). Версия — та, что видел преподаватель:
 * новая сдача ученика не будет оценена вслепую.
 */
export async function homeworkDecision(
  ctx: TenantContext,
  api: TelegramApi,
  from: { id: number; first_name?: string; username?: string },
  chatId: number,
  data: string,
  pressed?: { messageId: number },
): Promise<void> {
  const isStaff = (await isSeller(ctx, from.id)) || Boolean(await curatorByTelegram(ctx, from.id));
  if (!isStaff) {
    await say(api, chatId, "⛔ Кнопка доступна только продавцу этого магазина.");
    return;
  }
  const [kind, ref = "", revRaw = "", midRaw = ""] = data.split(":");
  const rev = Number(revRaw);
  const mid = midRaw ? Number(midRaw) : null;
  const { resolveHwRef, readHwDraft, dropHwDraft } = await import("@/core/courses/review-ref");
  const target = await resolveHwRef(ctx, ref);
  if (target && !(await mayReview(ctx, from.id, target.orderItemId))) {
    await say(api, chatId, "⛔ Эта работа назначена другому куратору.");
    return;
  }
  if (!target || !Number.isInteger(rev)) {
    await say(api, chatId, "Не нашёл эту работу — откройте «Домашние задания» в панели.");
    return;
  }
  const comment = mid ? await readHwDraft(ctx, ref, mid) : null;
  const status = kind === "hwa" ? "accepted" : "revise";
  if (status === "revise" && !comment) {
    await say(
      api,
      chatId,
      "Чтобы вернуть на доработку, ответьте свайпом на уведомление о работе и напишите, что исправить.",
    );
    return;
  }
  const by = from.first_name?.trim() || (from.username ? `@${from.username}` : "Преподаватель");
  const { reviewAndNotify } = await import("@/app/admin/homework.server");
  const { isUserError } = await import("@/core/i18n/user-error");
  let r: { status: string; notified: boolean };
  try {
    r = await reviewAndNotify(ctx, { ...target, rev, status, text: comment ?? "", by });
  } catch (e) {
    // «уже проверена», «пришла новая версия» — словами продавцу, а не молчанием.
    if (!isUserError(e)) throw e;
    const stale = e.key === "err.homework.stale";
    await say(
      api,
      chatId,
      stale
        ? "Ученик прислал новую версию — уведомление о ней пришло отдельно, проверьте её."
        : "Эта работа уже проверена.",
    );
    return;
  }
  if (mid) await dropHwDraft(ctx, ref, mid).catch(() => {});
  if (pressed)
    await api
      .call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: pressed.messageId,
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => null);
  const head = status === "accepted" ? "✅ Работа принята." : "↩️ Работа отправлена на доработку.";
  await say(
    api,
    chatId,
    r.notified
      ? `${head} Ученик получил сообщение.`
      : `${head} Сообщение ученику не дошло — он увидит оценку на странице курса.`,
  );
}
