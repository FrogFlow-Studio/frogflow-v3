import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { AnnounceSend } from "@/core/courses/announce.server";
import { telegramApi } from "./api";
import { COPY, escapeHtml } from "./copy";

/**
 * Сообщение «открыт урок N» со ссылкой на курс. Название урока вставляется
 * как текст (HTML экранируется), ссылка — кнопкой. Один отправитель на крон
 * по расписанию и на «сразу после ДЗ/теста».
 */
export function lessonAnnouncer(ctx: TenantContext): AnnounceSend {
  const tg = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const m = COPY[ctx.tenant.settings.default_locale ?? "ru"] ?? COPY.ru;
  return async (a) => {
    const r = await tg.call("sendMessage", {
      chat_id: a.telegramId,
      text: escapeHtml(m.courseNewLesson(a.lessonNo, a.title)),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: m.courseOpenBtn, url: a.url }]] },
    });
    return r.ok;
  };
}

/** Сообщить ученику об открытом уроке сразу; сбой отправки не ломает приём работы. */
export async function announceLessonNow(ctx: TenantContext, orderItemId: string): Promise<void> {
  if (!ctx.tenant.telegramTokenEnc) return;
  try {
    const { announceOpenedLesson } = await import("@/core/courses/announce.server");
    await announceOpenedLesson(ctx, orderItemId, lessonAnnouncer(ctx));
  } catch (e) {
    const { reportError } = await import("@/lib/errors");
    await reportError(e, { where: "course.lessonNow", botId: ctx.tenant.id });
  }
}
