/**
 * Ключи общих бакетов Storage. Библиотека Supabase вставляет ключ в адрес
 * запроса как есть, без кодирования, а запрос уходит под service_role. Ключ
 * вида `a/%2e%2e/%2e%2e/rest/v1/bots` после раскодирования на той стороне
 * выходит из хранилища в REST-API базы, а `<bot_id>/../<чужой bot_id>/x`
 * проходит наивную проверку префикса. Поэтому любой ключ, пришедший извне
 * (адрес, форма админки, строка базы), проверяется здесь, одним правилом.
 *
 * Разрешены только буквы, цифры, «.», «_», «-», «(», «)» и пробел внутри
 * сегментов, сегменты через «/». Запрещены «%», «\», «?», «#», управляющие
 * символы, пустые сегменты, «.» и «..». Без Buffer и node:crypto: модуль
 * нужен и в браузере (админка).
 */
const SEGMENT = /^[\p{L}\p{N}._()\- ]{1,200}$/u;
const MAX_LEN = 512;
const MAX_DEPTH = 6;

export function isSafeStorageKey(key: string): boolean {
  if (!key || key.length > MAX_LEN) return false;
  const parts = key.split("/");
  if (parts.length > MAX_DEPTH) return false;
  return parts.every(
    (p) => SEGMENT.test(p) && p !== "." && p !== ".." && p.trim() === p && !/^\.+$/.test(p),
  );
}

/** Ключ лежит под префиксом арендатора и безопасен целиком. */
export function isTenantStorageKey(tenantId: string, key: string): boolean {
  return key.startsWith(`${tenantId}/`) && isSafeStorageKey(key);
}

const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/**
 * Ключ, на который можно выдать покупателю подписанную ссылку. Свой префикс —
 * да, чужой `<bot_id>/` — нет (строки заказов v1 и старые снимки материалов
 * пишутся не через проверки v2). Ключ без префикса — файл, залитый в v1 до
 * разметки ключей, — пропускаем, как v1 (tenant-storage-key.server.ts):
 * иначе у переехавших клиентов перестанут выдаваться старые заказы.
 */
export function isDeliverableStorageKey(tenantId: string, key: string): boolean {
  if (!isSafeStorageKey(key)) return false;
  const m = key.match(UUID_PREFIX);
  return !m || m[1]!.toLowerCase() === tenantId.toLowerCase();
}

/**
 * Ключ, пришедший из формы админки. Свой префикс — да. Ключ без префикса
 * (файл v1) — только если он уже записан у этой же строки базы: товар v1
 * сохраняется со своими старыми картинками и файлами, а новый ключ без
 * префикса — возможно, чужой файл v1 — через форму не подсунуть.
 */
export function isAdminInputStorageKey(
  tenantId: string,
  key: string,
  stored: ReadonlySet<string>,
): boolean {
  if (isTenantStorageKey(tenantId, key)) return true;
  return stored.has(key) && !UUID_PREFIX.test(key) && isSafeStorageKey(key);
}
