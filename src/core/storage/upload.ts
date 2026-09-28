/**
 * Правила загрузки файлов из админки. Сам файл браузер кладёт прямо в
 * Storage по подписанной ссылке: через функцию Vercel проходит не больше
 * 4,5 МБ тела запроса, а материалы и видео бывают по 200 МБ. Сервер только
 * выдаёт ссылку на ключ под префиксом клиента и после загрузки сверяет то,
 * что реально легло в бакет. Модуль без node-зависимостей.
 */
import { isSafeStorageKey, isTenantStorageKey } from "./keys";

export type UploadKind = "image" | "file" | "chatPhoto" | "chatFile" | "consultantMedia";

type UploadSpec = {
  bucket: "product-images" | "product-files";
  max: number;
  types: RegExp;
  /** Разрешённые расширения; без списка — любое. */
  exts?: readonly string[];
};

/**
 * Вложения из «Чата» уходят покупателю в мессенджер, поэтому их пределы —
 * общие для Telegram, Instagram и WhatsApp: фото JPEG или PNG до 5 МБ
 * (столько WhatsApp и Telegram берут по ссылке), документ до 20 МБ из
 * короткого списка форматов.
 */
export const UPLOAD_KINDS: Record<UploadKind, UploadSpec> = {
  image: {
    bucket: "product-images",
    max: 20 * 1024 * 1024,
    types: /^image\/(jpeg|png|gif|webp)$/,
  },
  file: { bucket: "product-files", max: 200 * 1024 * 1024, types: /.*/ },
  chatPhoto: {
    bucket: "product-images",
    max: 5 * 1024 * 1024,
    types: /^image\/(jpeg|png)$/,
    exts: ["jpg", "jpeg", "png"],
  },
  chatFile: {
    bucket: "product-files",
    max: 20 * 1024 * 1024,
    // Тип файла браузер знает не всегда — тогда решает расширение.
    types:
      /^(application\/(pdf|zip|x-zip-compressed|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|octet-stream)|text\/plain)$/,
    exts: ["pdf", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"],
  },
  /**
   * Фотобаза консультанта по прайсу: фото и короткие видео товара, которые
   * консультант шлёт покупателю в директ. Instagram берёт вложение до 25 МБ.
   */
  consultantMedia: {
    bucket: "product-images",
    max: 25 * 1024 * 1024,
    types: /^(image\/(jpeg|png|webp)|video\/(mp4|quicktime))$/,
    exts: ["jpg", "jpeg", "png", "webp", "mp4", "mov"],
  },
};

export function isUploadKind(v: unknown): v is UploadKind {
  return typeof v === "string" && Object.hasOwn(UPLOAD_KINDS, v);
}

export type UploadProblem = "too_big" | "bad_type" | "empty";

/**
 * Проверка файла: до выдачи ссылки — по словам браузера, после — по бакету.
 * `name` — имя файла или выданный ключ: по нему сверяется расширение.
 */
export function uploadProblem(
  kind: UploadKind,
  size: number,
  type: string,
  name = "",
): UploadProblem | null {
  const spec = UPLOAD_KINDS[kind];
  if (!Number.isFinite(size) || size <= 0) return "empty";
  if (size > spec.max) return "too_big";
  if (!spec.types.test(type)) return "bad_type";
  if (spec.exts && !spec.exts.includes(uploadExt(name))) return "bad_type";
  return null;
}

/** Расширение из имени файла: только латиница и цифры, до 8 знаков. */
export function uploadExt(name: string): string {
  const raw = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "bin"
  );
}

/** Новый ключ под префиксом клиента; `random` — hex-строка. */
export function newUploadKey(tenantId: string, random: string, name: string): string {
  const key = `${tenantId}/${random}.${uploadExt(name)}`;
  if (!isSafeStorageKey(key)) throw new Error("unsafe storage key");
  return key;
}

/**
 * Ключ, который браузер прислал на подтверждение, выдан этим же правилом:
 * префикс клиента, один сегмент hex и расширение. Чужие и старые ключи
 * через подтверждение не удалить.
 */
export function isIssuedUploadKey(tenantId: string, key: string): boolean {
  if (!isTenantStorageKey(tenantId, key)) return false;
  return /^[0-9a-f]{24}\.[a-z0-9]{1,8}$/.test(key.slice(tenantId.length + 1));
}

export function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}
