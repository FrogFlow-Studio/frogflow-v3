import { serviceDb } from "@/core/db/client.server";
import { REVOKED_PREFIX, revocationExpiresAt, revokedKey } from "./session-id";

/**
 * Отозванные сессии — строки `operator_settings` с ключом
 * `session_revoked:<sid>` и сроком в value (схема не меняется; таблица видна
 * только service_role). Своя строка на каждый выход: без гонки
 * «прочитал-дописал». «Не отозвана» кешируется на 30 секунд на копию
 * функции — отзыв доходит до всех с этой точностью, до своей копии сразу.
 */
const NEGATIVE_TTL_MS = 30_000;
const revoked = new Set<string>();
const checkedAt = new Map<string, number>();

export async function isSessionRevoked(sid: string, now = Date.now()): Promise<boolean> {
  if (revoked.has(sid)) return true;
  const at = checkedAt.get(sid);
  if (at !== undefined && now - at < NEGATIVE_TTL_MS) return false;
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("key")
    .eq("key", revokedKey(sid))
    .maybeSingle();
  // Не смогли проверить — не пускаем: лучше войти заново, чем пустить отозванную.
  if (error) throw new Error(`проверка сессии: ${error.message}`);
  if (data) {
    revoked.add(sid);
    checkedAt.delete(sid);
    return true;
  }
  if (checkedAt.size > 5000) checkedAt.clear();
  checkedAt.set(sid, now);
  return false;
}

/** Выход: сессия отозвана везде, где бы ни лежала копия cookie. Истёкшие записи подчищаются. */
export async function revokeSession(sid: string, iat: number | undefined, now = Date.now()) {
  revoked.add(sid);
  checkedAt.delete(sid);
  const db = serviceDb();
  const { error } = await db
    .from("operator_settings")
    .upsert({ key: revokedKey(sid), value: revocationExpiresAt(iat, now) });
  if (error) throw new Error(`отзыв сессии: ${error.message}`);
  await db
    .from("operator_settings")
    .delete()
    .like("key", `${REVOKED_PREFIX}%`)
    .lt("value", new Date(now).toISOString());
}

/** Для тестов: забыть локальный кеш. */
export function resetRevocationCache() {
  revoked.clear();
  checkedAt.clear();
}
