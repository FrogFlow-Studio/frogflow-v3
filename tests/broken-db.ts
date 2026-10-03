import type { FakeDb } from "./fake-db";

/**
 * Копия fakeDb, где чтения из `tables` падают с ошибкой PostgREST (сбой базы), а
 * остальное работает как есть. Для проверок «не удалось прочитать ≠ нет данных».
 */
export function withBrokenReads<T extends FakeDb>(db: T, tables: string[]): T {
  const failing = (): unknown => {
    const result = { data: null, error: { message: "connection reset" }, count: null };
    const chain: Record<string | symbol, unknown> = {};
    return new Proxy(chain, {
      get: (_t, key) => {
        if (key === "then")
          return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
        return () => failing();
      },
    });
  };
  return new Proxy(db, {
    get: (target, key) => {
      if (key !== "from") return (target as Record<string | symbol, unknown>)[key];
      return (table: string) => (tables.includes(table) ? failing() : target.from(table));
    },
  });
}
