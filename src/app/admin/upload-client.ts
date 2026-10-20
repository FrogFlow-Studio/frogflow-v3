/**
 * Загрузка файла из браузера админки: ссылка от сервера, файл прямо в
 * Storage, подтверждение. Так файл не упирается в лимит тела запроса Vercel
 * (4,5 МБ). Возвращает ключ в бакете; ошибку бросает уже переведённой.
 */
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import type { UploadKind } from "@/core/storage/upload";
import { shownError } from "@/lib/shown-error";

/** Ответ сервера на подпись и подтверждение: мс; сам файл идёт отдельно. */
const CALL_TIMEOUT_MS = 30_000;
/** Загрузка файла без хода отправки: до 500 МБ при нормальной связи (30 минут). */
const PUT_TIMEOUT_MS = 30 * 60_000;

type Answer = { key?: string; url?: string; problem?: string; mb?: number; message?: string };

async function call(body: Record<string, unknown>): Promise<{ status: number; j: Answer }> {
  try {
    const r = await fetch("/api/admin/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const j = (await r.json().catch(() => ({}))) as Answer;
    return { status: r.ok ? 200 : r.status, j };
  } catch {
    // Обрыв или тайм-аут: статус 0, как у неудачной загрузки файла.
    return { status: 0, j: {} };
  }
}

const PROBLEM_TEXT: Record<string, AdminKey> = {
  too_big: "err.upload.tooBig",
  bad_type: "err.upload.badType",
  empty: "err.upload.empty",
  not_stored: "err.upload.notStored",
};

function fail(t: AdminT, j: Answer, fallback: string): Error {
  if (j.message) return shownError(j.message);
  const key = j.problem ? PROBLEM_TEXT[j.problem] : undefined;
  return shownError(key ? t(key, { mb: j.mb ?? "" }) : fallback);
}

/**
 * PUT в Storage. С `onProgress` — через XMLHttpRequest: у fetch нет хода
 * отправки, а на большом файле при плохой связи продавцу нужно видеть,
 * идёт загрузка или оборвалась (было в прежней админке).
 */
function put(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (sent: number, total: number) => void,
): Promise<{ ok: boolean; status: number; text?: string }> {
  if (!onProgress)
    return fetch(url, {
      method: "PUT",
      body: file,
      headers,
      signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    })
      .then(async (r) => ({ ok: r.ok, status: r.status, text: r.ok ? undefined : await r.text().catch(() => "") }))
      .catch(() => ({ ok: false, status: 0 }));
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: xhr.status >= 200 && xhr.status < 300 ? undefined : xhr.responseText,
      });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0 });
    xhr.send(file);
  });
}

export async function uploadFile(
  kind: UploadKind,
  file: File,
  t: AdminT,
  fallback: (status: number) => string,
  onProgress?: (sent: number, total: number) => void,
): Promise<string> {
  const type = file.type || "application/octet-stream";
  const sign = await call({ action: "sign", kind, name: file.name, size: file.size, type });
  if (sign.status !== 200 || !sign.j.key || !sign.j.url)
    throw fail(t, sign.j, fallback(sign.status));

  const sent = await put(
    sign.j.url,
    file,
    { "content-type": type, "cache-control": "max-age=3600", "x-upsert": "false" },
    onProgress,
  );
  if (!sent.ok) {
    if (sent.text) {
      try {
        const parsed = JSON.parse(sent.text) as { message?: string; error?: string };
        if (parsed.message && parsed.message.toLowerCase().includes("exceeded")) {
          throw shownError(
            `Файл превышает глобальный лимит хранилища Supabase (50 МБ). Увеличьте "Global file size limit" в панели Supabase (Storage -> Settings).`,
          );
        }
        if (parsed.message) {
          throw shownError(`Ошибка хранилища (${sent.status}): ${parsed.message}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Supabase")) throw e;
      }
    }
    if (sent.status === 413) {
      throw fail(t, { problem: "too_big", mb: 500 }, fallback(sent.status));
    }
    throw shownError(fallback(sent.status));
  }

  const done = await call({ action: "confirm", kind, key: sign.j.key });
  if (done.status !== 200 || !done.j.key) throw fail(t, done.j, fallback(done.status));
  return done.j.key;
}
