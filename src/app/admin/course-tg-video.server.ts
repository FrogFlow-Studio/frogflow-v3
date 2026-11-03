import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { getCourse } from "@/core/courses/course.server";
import { adminTelegramApi } from "@/channels/telegram/notify";
import { adminRecipients } from "@/core/notify/recipients";

/**
 * «Прислать мне в Telegram» у видео урока из бота (03.11.2026, просьба
 * Якова): file_id видит только бот, на сайте видео не показать — бот шлёт
 * его продавцу в чат, с подписью урока. Владелец получает сам, сотрудник —
 * в чаты уведомлений магазина. Одна отправка на нажатие, без повторов.
 */
export async function sendLessonTgVideo(
  ctx: TenantContext,
  productId: string,
  lessonId: string,
  fileId: string,
  isOwner: boolean,
): Promise<{ sent: number; target: "you" | "chat" }> {
  const lessons = (await getCourse(ctx, productId)).lessons;
  const i = lessons.findIndex((l) => l.id === lessonId);
  const l = lessons[i];
  const k = l?.tgVideos?.indexOf(fileId) ?? -1;
  if (!l || k < 0)
    throw new UserError(
      "err.course.tgVideoGone",
      "Этого видео в уроке уже нет — обновите страницу.",
    );
  const own = isOwner && ctx.tenant.ownerTelegramId ? String(ctx.tenant.ownerTelegramId) : null;
  const target = own ? "you" : "chat";
  const api = adminTelegramApi(ctx);
  if (!api) return { sent: 0, target };
  const ids = own ? [own] : await adminRecipients(ctx);
  let sent = 0;
  for (const chat_id of ids) {
    const r = await api.call("sendVideo", {
      chat_id,
      video: fileId,
      caption: `🎬 ${i + 1}. ${l.title}${(l.tgVideos?.length ?? 0) > 1 ? ` · ${k + 1}` : ""}`.slice(
        0,
        1024,
      ),
      protect_content: true,
    });
    if (r.ok) sent++;
  }
  return { sent, target };
}
