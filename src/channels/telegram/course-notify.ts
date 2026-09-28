import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Homework } from "@/core/courses/homework";
import { escapeHtml } from "./copy";

/**
 * Преподавателю: ученик сдал домашнее задание. Тем же путём, что вопросы
 * покупателей (Telegram продавца, push админки, почта — по матрице), но в
 * Telegram — с фото работы и кнопкой «Принять»; ответ свайпом на это
 * сообщение становится комментарием (channels/telegram/homework-review).
 */
export async function notifyHomework(ctx: TenantContext, hw: Homework): Promise<number> {
  const { notifyAdminsHtml } = await import("./notify");
  const { saveHwRef, hwRefMark } = await import("@/core/courses/review-ref");
  const ref = await saveHwRef(ctx, { orderItemId: hw.orderItemId, lessonId: hw.lessonId });
  const last = hw.attempts.at(-1);
  const again = hw.attempts.length > 1;
  const lines = [
    again ? "📝 <b>Домашнее задание — новая версия</b>" : "📝 <b>Новое домашнее задание</b>",
    `🎓 ${escapeHtml(hw.course)} · урок ${hw.lessonNo} «${escapeHtml(hw.lessonTitle)}»`,
    `👤 ${escapeHtml(hw.student)}`,
    last?.text ? `💬 ${escapeHtml(last.text.slice(0, 1500))}` : "",
    last?.files.length ? `📎 файлов: ${last.files.length}` : "",
    "",
    "↩️ Ответьте на это сообщение свайпом — комментарий уйдёт ученику, затем выберите «Принять» или «На доработку».",
    `Все работы: ${ctx.appUrl.replace(/\/+$/, "")}/admin/homework`,
    hwRefMark(ref),
  ].filter((l) => l !== "");
  return notifyAdminsHtml(ctx, lines.join("\n"), {
    kind: "homework",
    replyMarkup: {
      inline_keyboard: [[{ text: "✅ Принять", callback_data: `hwa:${ref}:${hw.rev}` }]],
    },
    photos: await photoUrls(ctx, hw),
  });
}

/** Картинки последней сдачи — подписанные ссылки на сутки (HEIC Telegram не покажет). */
async function photoUrls(ctx: TenantContext, hw: Homework): Promise<string[]> {
  const { isTenantStorageKey } = await import("@/core/storage/keys");
  const { signedFileUrl } = await import("@/core/orders/orders");
  const out: string[] = [];
  for (const f of hw.attempts.at(-1)?.files ?? []) {
    if (!f.mime.startsWith("image/") || f.mime === "image/heic") continue;
    if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
    const url = await signedFileUrl(f.path, 24 * 3600).catch(() => null);
    if (url) out.push(url);
  }
  return out;
}
