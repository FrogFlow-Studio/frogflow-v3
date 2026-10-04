/**
 * Короткий кеш каталога витрины в памяти процесса: один и тот же запрос
 * покупателей в течение минуты не ходит в базу заново. Остатки и цены при
 * заказе всё равно проверяются при оформлении, кеш влияет только на показ.
 * Хранит ограниченное число ключей — старые вытесняются.
 */
export const CATALOG_TTL_MS = 60_000;
const MAX_KEYS = 300;

export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now) {
  const map = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at >= ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T): void {
      if (map.size >= MAX_KEYS && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, { at: now(), value });
    },
    get size(): number {
      return map.size;
    },
  };
}
