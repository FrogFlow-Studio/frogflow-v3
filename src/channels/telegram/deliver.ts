import { rejectedForSure, UPLOAD_TIMEOUT_MS, type TelegramApi } from "./api";
import type { LanguageAsker, MaterialSender } from "@/core/orders/orders";
import { localeFlags, localeNames } from "@/core/i18n/locale";
import { signedFileUrl } from "@/core/orders/orders";
import { materialDownloadName } from "@/core/orders/pure";
import { escapeHtml, type Msg } from "./copy";
import { readCapped } from "@/lib/read-capped";

const MB = 1024 * 1024;
/** Предел загрузки файла через облачный Bot API. */
export const TELEGRAM_UPLOAD_MAX = 50 * MB;
/** По ссылке Telegram скачивает документ сам — только эти типы и до 20 МБ. */
const URL_TYPES = new Set(["pdf", "zip", "gif"]);
const URL_MAX = 20 * MB;
/** Картинка до 10 МБ — фото в чате, как в v1 (у sendPhoto свой предел). */
const PHOTO_TYPES = new Set(["jpg", "jpeg", "png", "webp"]);
const PHOTO_MAX = 10 * MB;
/**
 * Общий бюджет времени на выдачу файлами: функция живёт 120 с, и выдача,
 * которую убили посреди загрузки, осталась бы в «выдаётся». Что не
 * успевает в бюджет — уходит ссылкой.
 */
export const DELIVERY_BUDGET_MS = 80_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Меньше этого на скачивание или загрузку не начинаем — сразу ссылка. */
const MIN_SLOT_MS = 10_000;

/** Размер файла по подписанной ссылке (HEAD); null — не узнали. */
async function remoteSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    const n = Number(res.headers.get("content-length"));
    return res.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Файл из хранилища в память, не больше предела загрузки; иначе null. */
async function download(url: string, timeoutMs: number): Promise<Blob | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const bytes = await readCapped(res, TELEGRAM_UPLOAD_MAX);
    if (!bytes?.byteLength) return null;
    return new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: res.headers.get("content-type") ?? "application/octet-stream",
    });
  } catch {
    return null;
  }
}

/**
 * Отправка материалов заказа в чат, как в v1 (orders.server.ts, sendFile):
 * внешняя ссылка — сообщением; файл из хранилища — pdf/zip/gif до 20 МБ
 * документом по подписанной ссылке (Telegram скачает сам), остальное до
 * предела Bot API (50 МБ) — самим файлом (картинка до 10 МБ — фото), больше
 * предела, при отказе или когда не успевает в бюджет времени — ссылкой на
 * 7 дней. Загрузка одной попыткой: второй экземпляр файла хуже ссылки.
 */
export function telegramMaterialSender(
  api: TelegramApi,
  chatId: number,
  m: Msg,
  budgetMs = DELIVERY_BUDGET_MS,
): MaterialSender {
  return async (item, materials) => {
    const deadline = Date.now() + budgetMs;
    const left = (cap: number) => Math.min(cap, deadline - Date.now());
    let allOk = true;
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i]!;
      const caption = i === 0 ? `📁 <b>${escapeHtml(item.name_snapshot)}</b>` : "";
      let ok = false;
      if (mat.url) {
        const r = await api.call("sendMessage", {
          chat_id: chatId,
          text: `${caption ? caption + "\n\n" : ""}<a href="${mat.url}">${m.fileLink}</a>`,
          parse_mode: "HTML",
        });
        ok = r.ok;
      } else if (mat.path) {
        const name = materialDownloadName(mat, item.name_snapshot, materials);
        const url = await signedFileUrl(mat.path, undefined, name);
        if (url) {
          const ext = (mat.name ?? mat.path).split(".").pop()?.toLowerCase() ?? "";
          const size = await remoteSize(url);
          if (URL_TYPES.has(ext) && (size === null || size <= URL_MAX)) {
            const r = await api.call("sendDocument", {
              chat_id: chatId,
              document: url,
              caption: item.name_snapshot,
            });
            ok = r.ok;
          }
          if (
            !ok &&
            api.upload &&
            (size === null || size <= TELEGRAM_UPLOAD_MAX) &&
            left(DOWNLOAD_TIMEOUT_MS) >= MIN_SLOT_MS
          ) {
            const data = await download(url, left(DOWNLOAD_TIMEOUT_MS));
            const timeoutMs = left(UPLOAD_TIMEOUT_MS);
            if (data && timeoutMs >= MIN_SLOT_MS)
              ok = await uploadFile(api, chatId, item.name_snapshot, name, ext, data, timeoutMs);
          }
          if (!ok) {
            const mb = size ? ` (${Math.round(size / MB)} МБ)` : "";
            const r = await api.call("sendMessage", {
              chat_id: chatId,
              text: `${caption ? caption + "\n\n" : ""}<a href="${url}">${m.fileLink}${mb}</a>\n\n<i>${m.fileLinkTtl}</i>`,
              parse_mode: "HTML",
            });
            ok = r.ok;
          }
        }
      }
      if (!ok) allOk = false;
    }
    return allOk ? "sent" : "failed";
  };
}

async function uploadFile(
  api: TelegramApi,
  chatId: number,
  caption: string,
  name: string,
  ext: string,
  data: Blob,
  timeoutMs: number,
): Promise<boolean> {
  const fields = { chat_id: chatId, caption };
  const opts = { once: true, timeoutMs };
  if (PHOTO_TYPES.has(ext) && data.size <= PHOTO_MAX) {
    const r = await api.upload!("sendPhoto", fields, { field: "photo", name, data }, opts);
    if (r.ok) return true;
    // Обрыв или 5xx: фото могло дойти — документ вслед был бы вторым экземпляром.
    if (!rejectedForSure(r)) return false;
  }
  const r = await api.upload!("sendDocument", fields, { field: "document", name, data }, opts);
  return r.ok;
}

/** Вопрос «на каком языке» кнопками; ответ приходит callback `lang:<order>:<item>:<lang>`. */
export function telegramLanguageAsker(api: TelegramApi, chatId: number, m: Msg): LanguageAsker {
  return async (item, langs) => {
    const r = await api.call("sendMessage", {
      chat_id: chatId,
      text: m.chooseItemLanguage(escapeHtml(item.name_snapshot)),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          langs.map((l) => ({
            text: `${localeFlags[l]} ${localeNames[l]}`,
            callback_data: `lang:${item.order_id}:${item.id}:${l}`,
          })),
        ],
      },
    });
    return r.ok;
  };
}
