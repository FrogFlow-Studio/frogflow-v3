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
