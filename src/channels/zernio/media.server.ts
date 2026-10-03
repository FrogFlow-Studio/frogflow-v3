import type { TenantContext } from "@/core/tenant/resolve.server";
import { imageUrl } from "@/core/catalog/catalog";
import { uploadExt } from "@/core/storage/upload";
import { contentMatchesExt } from "@/core/storage/sniff";

/**
 * Фото, которое Instagram и WhatsApp примут вложением (документация Zernio):
 * только JPEG или PNG, Instagram — до 8 МБ, WhatsApp — до 5 МБ. Загрузка в
 * каталог разрешает и GIF/WebP до 20 МБ: такое фото Meta отклонит, а вместе
 * с ним и всю карточку. Поэтому перед отправкой смотрим тип и размер в
 * бакете и первые байты файла (тип в бакете ставит браузер, расширение —
 * имя: WebP под именем .jpg с типом image/jpeg прошёл бы); не подходит —
 * следующее фото товара или без фото (текст уйдёт).
 */
export const ZERNIO_IMAGE_MAX: Record<"instagram" | "whatsapp", number> = {
  instagram: 8 * 1024 * 1024,
  whatsapp: 5 * 1024 * 1024,
};
const OK_TYPE = /^image\/(jpeg|png)$/i;
const OK_EXT = ["jpg", "jpeg", "png"];
/** Сколько фото товара проверяем, прежде чем слать без фото. */
const MAX_CHECKS = 3;

/** `head` — первые байты файла: по ним сверяется формат. */
export type ImageInfo = { size: number; contentType: string; head: Uint8Array } | null;
export type ImageInfoReader = (ctx: TenantContext, path: string) => Promise<ImageInfo>;

const HEAD_BYTES = 16;
/** Читаем только первые байты: ждём недолго. */
const MEDIA_HEAD_TIMEOUT_MS = 15_000;

/**
 * Первые байты файла из закрытого бакета: подписанная ссылка на минуту и
 * запрос Range — всё фото (до 20 МБ) ради сигнатуры не качаем. Если
 * хранилище Range не учло, читаем только первый кусок потока и закрываем его.
 */
async function readHead(
  bucket: ReturnType<
    ReturnType<typeof import("@/core/db/client.server").serviceDb>["storage"]["from"]
  >,
  key: string,
): Promise<Uint8Array> {
  const { data, error } = await bucket.createSignedUrl(key, 60);
  if (error || !data?.signedUrl) throw new Error(`нет подписанной ссылки на ${key}`);
  const res = await fetch(data.signedUrl, {
    headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    signal: AbortSignal.timeout(MEDIA_HEAD_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`хранилище ответило ${res.status} на ${key}`);
  const reader = res.body.getReader();
  const head = new Uint8Array(HEAD_BYTES);
  let got = 0;
  try {
    while (got < HEAD_BYTES) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const part = value.subarray(0, HEAD_BYTES - got);
      head.set(part, got);
      got += part.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return head.slice(0, got);
}

/** «Нет такого объекта» у Storage: status 404 или statusCode "404"/not_found в теле. */
function isNotFound(error: { status?: unknown; statusCode?: unknown; message?: string }): boolean {
  return (
    Number(error.status) === 404 ||
    String(error.statusCode) === "404" ||
    /not[ _-]?found/i.test(error.message ?? "")
  );
}

/** Тип, размер и первые байты картинки в бакете; ключ с префиксом арендатора, иначе старый без него. */
async function readStorageImageInfo(ctx: TenantContext, path: string): Promise<ImageInfo> {
  const { serviceDb } = await import("@/core/db/client.server");
  const bucket = serviceDb().storage.from("product-images");
  for (const key of [`${ctx.tenant.id}/${path}`, path]) {
    const { data, error } = await bucket.info(key);
    // Файла нет — пробуем старый ключ; сбой хранилища — ошибка, чтобы кэш
    // не запомнил его на 10 минут как «нет фото».
    if (error && !isNotFound(error)) throw new Error(`хранилище: ${key}`);
    if (data)
      return {
        size: Number(data.size ?? 0),
        contentType: String(data.contentType ?? ""),
        head: await readHead(bucket, key),
      };
  }
  return null;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 1000;

/**
 * Проверка фото запоминается на 10 минут: карточку товара листают много
 * покупателей, и без памяти каждый показ стоил бы хранилищу два-три запроса
 * на фото. Ключ — арендатор и путь (новое фото товара — новый путь). Ошибку
 * чтения не запоминаем: следующий показ спросит хранилище снова.
 */
export function cacheImageInfo(
  read: ImageInfoReader,
  now: () => number = Date.now,
): ImageInfoReader {
  const cache = new Map<string, { at: number; info: ImageInfo }>();
  return async (ctx, path) => {
    const key = `${ctx.tenant.id}:${path}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.info;
    const info = await read(ctx, path);
    cache.delete(key);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now(), info });
    return info;
  };
}

export const storageImageInfo: ImageInfoReader = cacheImageInfo(readStorageImageInfo);

export function fitsZernio(
  platform: "instagram" | "whatsapp",
  path: string,
  info: NonNullable<ImageInfo>,
): boolean {
  // Тип из бакета важнее расширения: WebP мог лечь под именем .jpg. Без типа — по расширению.
  const typeOk = info.contentType
    ? OK_TYPE.test(info.contentType)
    : OK_EXT.includes(uploadExt(path));
  // И то и другое задал загрузивший — решают первые байты файла.
  const bytesOk = contentMatchesExt("jpg", info.head) || contentMatchesExt("png", info.head);
  return typeOk && bytesOk && info.size > 0 && info.size <= ZERNIO_IMAGE_MAX[platform];
}

/** Ссылка на первое подходящее фото из списка; null — отправить без фото. */
export async function zernioImageUrl(
  ctx: TenantContext,
  platform: "instagram" | "whatsapp",
  paths: ReadonlyArray<string | null | undefined>,
  read: ImageInfoReader = storageImageInfo,
): Promise<string | null> {
  for (const path of paths.filter((p): p is string => Boolean(p)).slice(0, MAX_CHECKS)) {
    const info = await read(ctx, path).catch(() => null);
    if (info && fitsZernio(platform, path, info)) return imageUrl(ctx, path);
  }
  return null;
}
