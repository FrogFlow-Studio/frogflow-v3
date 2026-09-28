import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Чтение для модуля курсов по правилам репозитория: длинный `.in()` —
 * кусками по 200, ошибка чтения — сбой, а не «пусто».
 */
export const IN_CHUNK = 200;

export async function selectIn<T>(
  what: string,
  ids: readonly (string | number)[],
  query: (chunk: (string | number)[]) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const { data, error } = await query(uniq.slice(i, i + IN_CHUNK));
    if (error) throw serverFailure(`${what}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

/** app_settings по ключам; нет строки — нет в карте. */
export async function readSettings(
  ctx: TenantContext,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const rows = await selectIn<{ key: string; value: string | null }>(
    "настройки курса",
    keys,
    (chunk) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .in("key", chunk as string[]),
  );
  const out = new Map<string, string>();
  for (const r of rows) if (r.value != null) out.set(r.key, r.value);
  return out;
}
