import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ключ арендатора для PostgREST: JWT с `role: tenant_bot` и `bot_id`.
 *
 * В v1 такой ключ выпускался один раз на деплой (scripts/mint-tenant-key.mjs)
 * и лежал в переменной SUPABASE_TENANT_KEY — по одному деплою на клиента.
 * В v2 деплой один, поэтому ключ подписывается на лету под того арендатора,
 * которого определил резолвер, и живёт недолго. Изоляция при этом та же:
 * RLS-политики из MIGRATION-02 фильтруют каждую строку по claim'у bot_id, и
 * код с ключом арендатора физически не может прочитать чужое — даже если
 * где-то забыт фильтр.
 */

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type TenantClaims = {
  role: "tenant_bot";
  bot_id: string;
  iss: "supabase";
  iat: number;
  exp: number;
};

export const TENANT_JWT_TTL_SEC = 60 * 60;

export function mintTenantJwt(
  botId: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
  ttlSec: number = TENANT_JWT_TTL_SEC,
): string {
  if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error(`Некорректный bot_id: ${botId}`);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: TenantClaims = {
    role: "tenant_bot",
    bot_id: botId,
    iss: "supabase",
    iat: now,
    exp: now + ttlSec,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

/** Разбор без проверки подписи — для тестов и диагностики. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function verifyTenantJwt(token: string, secret: string): TenantClaims | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const claims = decodeJwtPayload(token) as Partial<TenantClaims>;
  if (claims.role !== "tenant_bot" || typeof claims.bot_id !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims as TenantClaims;
}
