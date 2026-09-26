/**
 * Номер сессии в cookie. Cookie запечатана и живёт сама по себе: выход
 * стирает её в браузере, но скопированная копия раньше работала ещё 14 дней.
 * Теперь у каждого входа свой номер (sid) и время выдачи (iat); выход
 * заносит номер в список отозванных (revocation.server), а сессия старше
 * срока не принимается, даже если браузер её прислал.
 */
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 14;
export const REVOKED_PREFIX = "session_revoked:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function isSessionId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Выдана не раньше срока и не «из будущего» (минута на расхождение часов). */
export function sessionFresh(iat: unknown, now = Date.now()): boolean {
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;
  return iat <= now + 60_000 && now - iat < SESSION_MAX_AGE_S * 1000;
}

export function revokedKey(sid: string): string {
  return `${REVOKED_PREFIX}${sid}`;
}

/** Когда запись об отзыве можно удалить: сессия к тому времени всё равно истекла бы. */
export function revocationExpiresAt(iat: number | undefined, now = Date.now()): string {
  const base = typeof iat === "number" && Number.isFinite(iat) ? Math.min(iat, now) : now;
  return new Date(base + SESSION_MAX_AGE_S * 1000).toISOString();
}

/** Метка для cookie при входе. */
export function issueSession(now = Date.now()): { sid: string; iat: number } {
  return { sid: newSessionId(), iat: now };
}

/** То же для входа оператора (поля верхнего уровня cookie). */
export function operatorSessionMark(now = Date.now()): {
  operatorSid: string;
  operatorIat: number;
} {
  const { sid, iat } = issueSession(now);
  return { operatorSid: sid, operatorIat: iat };
}
