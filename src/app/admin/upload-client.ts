/**
 * Загрузка файла из браузера админки: ссылка от сервера, файл прямо в
 * Storage, подтверждение. Так файл не упирается в лимит тела запроса Vercel
 * (4,5 МБ). Возвращает ключ в бакете; ошибку бросает уже переведённой.
 */
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import type { UploadKind } from "@/core/storage/upload";
import { shownError } from "@/lib/shown-error";

type Answer = { key?: string; url?: string; problem?: string; mb?: number };

async function call(body: Record<string, unknown>): Promise<{ status: number; j: Answer }> {
  const r = await fetch("/api/admin/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Answer;
  return { status: r.ok ? 200 : r.status, j };
}

const PROBLEM_TEXT: Record<string, AdminKey> = {
  too_big: "err.upload.tooBig",
  bad_type: "err.upload.badType",
  empty: "err.upload.empty",
  not_stored: "err.upload.notStored",
};

function fail(t: AdminT, j: Answer, fallback: string): Error {
  const key = j.problem ? PROBLEM_TEXT[j.problem] : undefined;
  return shownError(key ? t(key, { mb: j.mb ?? "" }) : fallback);
}

export async function uploadFile(
  kind: UploadKind,
  file: File,
  t: AdminT,
  fallback: (status: number) => string,
): Promise<string> {
  const type = file.type || "application/octet-stream";
  const sign = await call({ action: "sign", kind, name: file.name, size: file.size, type });
  if (sign.status !== 200 || !sign.j.key || !sign.j.url)
    throw fail(t, sign.j, fallback(sign.status));

  const put = await fetch(sign.j.url, {
    method: "PUT",
    body: file,
    headers: { "content-type": type, "cache-control": "max-age=3600", "x-upsert": "false" },
  }).catch(() => null);
  if (!put?.ok) throw shownError(fallback(put?.status ?? 0));

  const done = await call({ action: "confirm", kind, key: sign.j.key });
  if (done.status !== 200 || !done.j.key) throw fail(t, done.j, fallback(done.status));
  return done.j.key;
}
