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
  // Школа с кураторами: работа уходит одному назначенному куратору, а не всем.
  const { ensureCurator } = await import("@/core/courses/curators.server");
  // Сбой назначения куратора не теряет работу: она уходит продавцам, как без кураторов.
  const curator = await ensureCurator(ctx, hw.orderItemId).catch(() => null);
  const last = hw.attempts.at(-1);
  const again = hw.attempts.length > 1;
  const lines = [
    again ? "📝 <b>Домашнее задание — новая версия</b>" : "📝 <b>Новое домашнее задание</b>",
    `🎓 ${escapeHtml(hw.course)} · урок ${hw.lessonNo} «${escapeHtml(hw.lessonTitle)}»`,
    `👤 ${escapeHtml(hw.student)}`,
    last?.text ? `💬 ${escapeHtml(last.text.slice(0, 1500))}` : "",
    last?.files.length ? `📎 файлов: ${last.files.length}` : "",
    ...(await mediaLinks(ctx, hw)),
    "",
    "↩️ Ответьте на это сообщение свайпом — комментарий уйдёт ученику, затем выберите «Принять» или «На доработку».",
    `Все работы: ${ctx.appUrl.replace(/\/+$/, "")}/admin/homework`,
    hwRefMark(ref),
  ].filter((l) => l !== "");
  const opts = {
    kind: "homework",
    replyMarkup: {
      inline_keyboard: [[{ text: "✅ Принять", callback_data: `hwa:${ref}:${hw.rev}` }]],
    },
    photos: await photoUrls(ctx, hw),
  };
  if (!curator) return notifyAdminsHtml(ctx, lines.join("\n"), opts);
  const sent = await notifyAdminsHtml(ctx, lines.join("\n"), {
    ...opts,
    recipients: [String(curator.telegram_id)],
  });
  if (sent > 0) return sent;
  // Куратор не начинал диалог с ботом (или заблокировал его): работу не теряем,
  // она уходит продавцам, с пометкой почему.
  const warn = `⚠️ Куратору ${escapeHtml(curator.name)} не доставлено (он не начал диалог с ботом) — работа пришла вам`;
  return notifyAdminsHtml(ctx, [warn, ...lines].join("\n"), opts);
}

/** Голосовое и видео последней сдачи — ссылки на сутки: фото Telegram покажет само, их — нет. */
async function mediaLinks(ctx: TenantContext, hw: Homework): Promise<string[]> {
  const { isTenantStorageKey } = await import("@/core/storage/keys");
  const { signedFileUrl } = await import("@/core/orders/orders");
  const { isMediaMime } = await import("@/core/courses/homework");
  const out: string[] = [];
  for (const f of hw.attempts.at(-1)?.files ?? []) {
    if (!isMediaMime(f.mime) || !isTenantStorageKey(ctx.tenant.id, f.path)) continue;
    const url = await signedFileUrl(f.path, 24 * 3600).catch(() => null);
    if (url)
      out.push(
        `${f.mime.startsWith("video/") ? "🎥" : "🎧"} <a href="${escapeHtml(url)}">${escapeHtml(f.name ?? f.path.split("/").pop() ?? "")}</a>`,
      );
  }
  return out;
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
