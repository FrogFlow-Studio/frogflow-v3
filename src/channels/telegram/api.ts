/**
 * Клиент Telegram Bot API. Токен — параметр, не окружение: один деплой
 * обслуживает много ботов.
 */
export type TgResult<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  /** Код ответа Telegram; нет — ответа не было (обрыв, тайм-аут). */
  error_code?: number;
};

/**
 * Telegram ответил и точно не принял (4xx, кроме 429): можно пробовать
 * иначе. Обрыв, тайм-аут, 5xx — неизвестно, дошло ли, повторять нельзя.
 */
export function rejectedForSure(r: TgResult): boolean {
  const code = r.error_code;
  return !r.ok && code !== undefined && code >= 400 && code < 500 && code !== 429;
}

export type TelegramUploadFile = { field: string; name: string; data: Blob };
export type TelegramUploadOptions = {
  /**
   * Одна попытка: без повтора после обрыва, тайм-аута, 5xx и 429. Для выдачи
   * файла так и надо: Telegram мог файл принять и не успеть ответить, повтор
   * прислал бы покупателю второй экземпляр; выдача в этом случае уходит
   * ссылкой (channels/telegram/deliver.ts).
   */
  once?: boolean;
  /** Предел на одну попытку, мс (по умолчанию UPLOAD_TIMEOUT_MS). */
  timeoutMs?: number;
};

/** Сколько ждать ответа на загрузку файла: 50 МБ идут 12–20 с. */
export const UPLOAD_TIMEOUT_MS = 45_000;

export type TelegramApi = {
  call<T = unknown>(method: string, payload?: unknown): Promise<TgResult<T>>;
  fileUrl(filePath: string): string;
  /** Отправка файла самим файлом (multipart); у подставных клиентов тестов может не быть. */
  upload?(
    method: string,
    fields: Record<string, string | number>,
    file: TelegramUploadFile,
    opts?: TelegramUploadOptions,
  ): Promise<TgResult>;
};

import { beforeExternalEffect } from "@/lib/external-effects";
import { PREVIEW_SEND_OFF, previewReadonly } from "@/lib/preview";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Сколько ждать ответа на обычный вызов Bot API, мс. */
export const CALL_TIMEOUT_MS = 20_000;

type TgBody<T> = TgResult<T> & { parameters?: { retry_after?: number } };

/**
 * Одна отправка с повторами. Чтение (`retryable`) повторяется на обрыве,
 * тайм-ауте, 5xx и 429. Отправка — только на 429: Telegram явно сказал, что
 * не принял, и назвал паузу (`retry_after`). Обрыв, тайм-аут и 5xx — неизвестно,
 * дошло ли: результат без `error_code`, повтора нет.
 */
async function attempts<T>(
  method: string,
  retryable: boolean,
  max: number,
  send: () => Promise<Response>,
): Promise<TgResult<T>> {
  for (let attempt = 1; attempt <= max; attempt++) {
    let res: Response;
    try {
      res = await send();
    } catch (e) {
      const timeout = e instanceof Error && e.name === "TimeoutError";
      console.error(`[tg] ${method}: ${timeout ? "тайм-аут" : "сеть"}`, e);
      if (!retryable || attempt === max) {
        return { ok: false, description: timeout ? "timeout" : "network error" };
      }
      await sleep(1000 * attempt);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as TgBody<T>;
    if (res.status === 429 && attempt < max) {
      await sleep((data.parameters?.retry_after ?? attempt * 2) * 1000);
      continue;
    }
    if (res.status >= 500) {
      if (retryable && attempt < max) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
        continue;
      }
      console.error(`[tg] ${method} failed`, res.status, data.description);
      // Без error_code: «неизвестно», как обрыв.
      return { ok: false, description: data.description ?? `http ${res.status}` };
    }
    const benign = /message is not modified/i.test(data.description ?? "");
    if ((!res.ok || data.ok === false) && !benign) {
      console.error(`[tg] ${method} failed`, res.status, data.description);
      return { ...data, ok: false, error_code: data.error_code ?? res.status };
    }
    return data;
  }
  return { ok: false, description: "retries exhausted" };
}

export function telegramApi(token: string, apiBase = "https://api.telegram.org"): TelegramApi {
  const base = apiBase.replace(/\/$/, "");
  const url = (method: string) => `${base}/bot${token}/${method}`;

  async function call<T>(method: string, payload: unknown = {}): Promise<TgResult<T>> {
    // Чтение (getMe, getFile…) — не отправка.
    const read = /^get/i.test(method);
    if (!read) {
      // Без error_code: «неизвестно», как обрыв — ни повтора, ни другого способа отправки.
      if (previewReadonly()) return { ok: false, description: PREVIEW_SEND_OFF };
      await beforeExternalEffect();
    }
    return attempts<T>(method, read, 3, () =>
      fetch(url(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      }),
    );
  }

  return {
    call,
    fileUrl: (filePath) => `${base}/file/bot${token}/${filePath}`,
    upload: (method, fields, file, opts) => telegramUpload(token, base, method, fields, file, opts),
  };
}

/**
 * Отправка файла самим файлом (multipart/form-data): по ссылке Telegram
 * принимает документы только PDF и ZIP и берёт имя из адреса. Каждая попытка
 * ограничена по времени. Повтор — только на 429 с `retry_after` (не больше
 * трёх попыток); с `once` — без повтора совсем.
 */
export async function telegramUpload(
  token: string,
  apiBase: string,
  method: string,
  fields: Record<string, string | number>,
  file: TelegramUploadFile,
  opts: TelegramUploadOptions = {},
): Promise<TgResult> {
  const url = `${apiBase.replace(/\/$/, "")}/bot${token}/${method}`;
  if (previewReadonly()) return { ok: false, description: PREVIEW_SEND_OFF };
  await beforeExternalEffect();
  return attempts(method, false, opts.once ? 1 : 3, () => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append(file.field, file.data, file.name);
    return fetch(url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? UPLOAD_TIMEOUT_MS),
    });
  });
}

/**
 * Фото с подписью, а если Telegram его точно не принял (4xx: формат, размер, ссылка) — то же
 * сообщение текстом. Обрыв, тайм-аут и 5xx — «неизвестно, дошло ли»: второй экземпляр хуже
 * тишины, поэтому запасной способ не запускается (CLAUDE.md, «Внешние вызовы»).
 * Возвращает true, если запасной текст не понадобился.
 */
export async function sendPhotoOrText(
  api: TelegramApi,
  photo: Record<string, unknown>,
  sendText: () => Promise<unknown>,
): Promise<boolean> {
  const r = await api.call("sendPhoto", photo);
  if (r.ok || !rejectedForSure(r)) return true;
  await sendText();
  return false;
}
