import { serverFailure } from "./server-failure";

/**
 * Длинный `.in(...)` уходит в адрес запроса: больше ~8 КБ (около 200 uuid) —
 * 431, и чтение молча перестаёт работать. Список неизвестной длины читаем
 * кусками. Повторы в списке убираются; ошибка любого куска — `serverFailure`
 * (не «данных нет»). Параметр колбэка называйте `chunk`: замок
 * `in-chunks.test.ts` узнаёт по нему безопасный `.in(…, chunk)`.
 */
export const IN_CHUNK = 200;

/** Список кусками не больше `size`. */
export function chunksOf<K>(keys: readonly K[], size = IN_CHUNK): K[][] {
  const out: K[][] = [];
  for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size));
  return out;
}

export async function inChunks<K, T>(
  keys: readonly K[],
  read: (chunk: K[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  size = IN_CHUNK,
): Promise<T[]> {
  const unique = [...new Set(keys)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += size) {
    const { data, error } = await read(unique.slice(i, i + size));
    if (error) throw serverFailure(`${what}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}
