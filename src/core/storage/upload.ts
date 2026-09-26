/**
 * Правила загрузки файлов из админки. Сам файл браузер кладёт прямо в
 * Storage по подписанной ссылке: через функцию Vercel проходит не больше
 * 4,5 МБ тела запроса, а материалы и видео бывают по 200 МБ. Сервер только
 * выдаёт ссылку на ключ под префиксом клиента и после загрузки сверяет то,
 * что реально легло в бакет. Модуль без node-зависимостей.
 */
import { isSafeStorageKey, isTenantStorageKey } from "./keys";

export type UploadKind = "image" | "file";

export const UPLOAD_KINDS: Record<
  UploadKind,
  { bucket: "product-images" | "product-files"; max: number; types: RegExp }
> = {
  image: {
    bucket: "product-images",
    max: 20 * 1024 * 1024,
    types: /^image\/(jpeg|png|gif|webp)$/,
  },
  file: { bucket: "product-files", max: 200 * 1024 * 1024, types: /.*/ },
};

export function isUploadKind(v: unknown): v is UploadKind {
  return v === "image" || v === "file";
}

export type UploadProblem = "too_big" | "bad_type" | "empty";

/** Проверка файла: до выдачи ссылки — по словам браузера, после — по бакету. */
export function uploadProblem(kind: UploadKind, size: number, type: string): UploadProblem | null {
  const spec = UPLOAD_KINDS[kind];
  if (!Number.isFinite(size) || size <= 0) return "empty";
  if (size > spec.max) return "too_big";
  if (!spec.types.test(type)) return "bad_type";
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
