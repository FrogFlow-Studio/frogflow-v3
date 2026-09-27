import { env } from "@/config/env";
import { imageUrl } from "@/core/catalog/catalog";
import { UserError } from "@/core/i18n/user-error";
import { contentMatchesExt } from "@/core/storage/sniff";
import { isIssuedUploadKey, uploadExt, uploadProblem, UPLOAD_KINDS } from "@/core/storage/upload";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Фото или документ в ответе продавца из «Чата». Файл браузер уже положил в
 * Storage (/api/admin/upload, виды chatPhoto и chatFile); здесь он заново
 * сверяется с правилами по тому, что лежит в бакете, — размер, тип и
 * содержимое по первым байтам, — и уходит покупателю в его канал.
 */
export type ChatAttachment = { kind: "photo" | "file"; key: string; name: string };

/** Вложение, прошедшее проверку: имя для покупателя и сам файл. */
export type CheckedAttachment = ChatAttachment & { fileName: string; data: Blob };

const KIND = { photo: "chatPhoto", file: "chatFile" } as const;
/** Столько Telegram разрешает в подписи к фото и документу. */
export const CAPTION_MAX = 1024;
const LINK_TTL_SEC = 7 * 24 * 3600;

/**
 * Имя файла для покупателя. Имя из браузера — только подпись: из него
 * убираются путь, служебные и невидимые символы (в том числе смена
 * направления текста, из-за которой «invoice‮fdp.exe» выглядит как
 * «invoiceexe.pdf»), точки по краям и его собственное расширение.
 * Расширение берётся из проверенного ключа в хранилище.
 */
export function cleanFileName(name: string, key: string): string {
  const ext = uploadExt(key);
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>|*?:]/gu, "")
    .replace(/\.[^.]*$/, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 100);
  return `${base || "file"}.${ext}`;
}

/** Строка в журнале переписки: вид вложения и подпись. */
export function attachmentLogText(att: ChatAttachment, text: string): string {
  const mark = att.kind === "photo" ? "[фото]" : `[файл: ${cleanFileName(att.name, att.key)}]`;
  return text.trim() ? `${mark} ${text.trim()}` : mark;
}

function problemError(): UserError {
  return new UserError(
    "err.admin.chatAttachmentBad",
    "Этот файл отправить нельзя: фото — JPEG или PNG до 5 МБ, документ — PDF, Word, Excel, PowerPoint, ZIP или TXT до 20 МБ.",
  );
}

function notStored(): UserError {
  return new UserError("err.upload.notStored", "Файл не дошёл до хранилища. Попробуйте ещё раз.");
}

/**
 * Вложение принадлежит магазину и проходит правила. Проверяем то, что
 * лежит в бакете, а не слова браузера: подтверждение загрузки можно было
 * пропустить, а тип файла браузер ставит сам. Поэтому содержимое сверяется
 * с расширением ключа по сигнатуре.
 */
export async function checkChatAttachment(
  ctx: TenantContext,
  att: ChatAttachment,
): Promise<CheckedAttachment> {
  if (!isIssuedUploadKey(ctx.tenant.id, att.key)) throw problemError();
  const { serviceDb } = await import("@/core/db/client.server");
  const bucket = serviceDb().storage.from(UPLOAD_KINDS[KIND[att.kind]].bucket);
  const { data: info, error } = await bucket.info(att.key);
  if (error || !info) throw notStored();
  if (uploadProblem(KIND[att.kind], Number(info.size), String(info.contentType ?? ""), att.key))
    throw problemError();
  // Размер уже проверен (до 20 МБ) — файл читаем целиком: для Telegram он всё равно нужен.
  const { data } = await bucket.download(att.key);
  if (!data) throw notStored();
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!contentMatchesExt(uploadExt(att.key), bytes)) throw problemError();
  return { ...att, fileName: cleanFileName(att.name, att.key), data };
}

/**
 * Отказ Telegram — продавцу понятными словами, а не «сбой на сервере».
 * Исходный текст Telegram — в журнал сервера.
 */
export function telegramRefusal(description: string | undefined): UserError {
  const d = description ?? "";
  if (d) console.error(`[chat] Telegram отказал: ${d}`);
  if (/blocked by the user|user is deactivated|chat not found|bot can't initiate/i.test(d))
    return new UserError(
      "err.admin.tgBuyerUnreachable",
      "Покупатель недоступен в Telegram: он заблокировал бота или удалил аккаунт.",
    );
  if (
    /too big|too large|PHOTO_INVALID_DIMENSIONS|IMAGE_PROCESS_FAILED|PHOTO_EXT_INVALID|wrong file|wrong type|file must be non-empty/i.test(
      d,
    )
  )
    return new UserError(
      "err.admin.tgFileRejected",
      "Telegram не принял файл: проверьте размер и формат или отправьте его документом.",
    );
  return new UserError("err.admin.sendTelegramFailed", "Не удалось отправить сообщение в Telegram");
}

/**
 * Telegram: файл уходит самим файлом (multipart), а не ссылкой — по ссылке
 * Telegram принимает документы только PDF и ZIP, а имя берёт из адреса.
 * Текст, который не влезает в подпись, идёт отдельным сообщением после
 * файла: если Telegram файл не принял, покупатель не получит текст без
 * файла, а повтор не пришлёт текст второй раз.
 */
export async function sendTelegramAttachment(
  ctx: TenantContext,
  chatId: number,
  text: string,
  att: CheckedAttachment,
): Promise<void> {
  const { telegramApi, telegramUpload } = await import("@/channels/telegram/api");
  const token = ctx.secrets.telegramToken();
  const base = env().TELEGRAM_API_BASE;
  const caption = text.length <= CAPTION_MAX ? text : "";
  const photo = att.kind === "photo";
  const r = await telegramUpload(
    token,
    base,
    photo ? "sendPhoto" : "sendDocument",
    { chat_id: chatId, ...(caption ? { caption } : {}) },
    { field: photo ? "photo" : "document", name: att.fileName, data: att.data },
  );
  if (!r.ok) throw telegramRefusal(r.description);
  if (text && !caption) {
    const t = await telegramApi(token, base).call("sendMessage", { chat_id: chatId, text });
    if (!t.ok) throw telegramRefusal(t.description);
  }
}

/**
 * Instagram и WhatsApp (через Zernio) берут вложение по ссылке. Фото — с
 * витринного адреса /api/img (постоянная ссылка, как у фото товаров).
 * Документ — подписанной ссылкой на 7 дней: WhatsApp показывает его файлом
 * с именем, Instagram документов в личке не принимает — туда уходит ссылка,
 * как у материалов заказа.
 */
export async function zernioAttachmentOptions(
  ctx: TenantContext,
  platform: "instagram" | "whatsapp",
  text: string,
  att: CheckedAttachment,
): Promise<{
  text: string;
  attachmentUrl?: string;
  attachmentType?: "image" | "file";
  attachmentName?: string;
}> {
  if (att.kind === "photo")
    return { text, attachmentUrl: imageUrl(ctx, att.key), attachmentType: "image" };
  const { signedFileUrl } = await import("@/core/orders/orders");
  const url = await signedFileUrl(att.key, LINK_TTL_SEC, att.fileName);
  if (!url) throw notStored();
  if (platform === "whatsapp")
    return { text, attachmentUrl: url, attachmentType: "file", attachmentName: att.fileName };
  const link = `📎 ${att.fileName}: ${url}\nСсылка действует 7 дней.`;
  return { text: text ? `${text}\n\n${link}` : link };
}
