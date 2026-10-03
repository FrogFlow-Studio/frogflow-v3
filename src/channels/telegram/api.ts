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

export function telegramApi(token: string, apiBase = "https://api.telegram.org"): TelegramApi {
  const base = apiBase.replace(/\/$/, "");
  const url = (method: string) => `${base}/bot${token}/${method}`;

  async function call<T>(method: string, payload: unknown = {}): Promise<TgResult<T>> {
    // Чтение (getMe, getFile…) — не отправка.
    if (!/^get/i.test(method)) {
      // Без error_code: «неизвестно», как обрыв — ни повтора, ни другого способа отправки.
      if (previewReadonly()) return { ok: false, description: PREVIEW_SEND_OFF };
      await beforeExternalEffect();
    }
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      let res: Response;
      try {
        res = await fetch(url(method), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error(`[tg] ${method}: сеть`, e);
        await sleep(1000 * attempt);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as TgResult<T> & {
        parameters?: { retry_after?: number };
      };
      if (res.status === 429 && attempt < MAX) {
        await sleep((data.parameters?.retry_after ?? attempt * 2) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < MAX) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
        continue;
      }
      const benign = /message is not modified/i.test(data.description ?? "");
      if ((!res.ok || data.ok === false) && !benign) {
        console.error(`[tg] ${method} failed`, res.status, data.description);
      }
      return data;
    }
    return { ok: false, description: "retries exhausted" };
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
 * ограничена по времени. Повтор — как у call (сеть, 429 и 5xx, не больше
 * трёх попыток), с `once` — без повтора.
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
  const MAX = opts.once ? 1 : 3;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append(file.field, file.data, file.name);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(opts.timeoutMs ?? UPLOAD_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === "TimeoutError";
      console.error(`[tg] ${method}: ${timeout ? "тайм-аут" : "сеть"}`, e);
      if (attempt === MAX) return { ok: false, description: timeout ? "timeout" : "network error" };
      await sleep(1000 * attempt);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as TgResult & {
      parameters?: { retry_after?: number };
    };
    if (res.status === 429 && attempt < MAX) {
      await sleep((data.parameters?.retry_after ?? attempt * 2) * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < MAX) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
      continue;
    }
    if (!res.ok || data.ok === false) {
      console.error(`[tg] ${method} failed`, res.status, data.description);
      return { ...data, ok: false, error_code: data.error_code ?? res.status };
    }
    return data;
  }
  return { ok: false, description: "retries exhausted" };
}
