import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Вход владельца в админку через Telegram: вместо пароля бот магазина
 * присылает владельцу (bots.owner_telegram_id) одноразовую ссылку на 10
 * минут. Виджет Telegram Login не нужен (ему требуется домен у BotFather).
 *
 * Токен хранится только хешем — строка app_settings
 * `admin_tg_login:<sha256>` с логином и сроком. Погашение — удаление строки
 * с возвратом (одна строка — один вход); ссылку открывает кнопка на
 * странице, а не загрузка: предпросмотр ссылки в Telegram её не погасит.
 */
export const TG_LOGIN_PREFIX = "admin_tg_login:";
export const TG_LOGIN_TTL_MS = 10 * 60_000;

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function newLoginToken(): string {
  return randomBytes(24).toString("hex");
}

/** Записать токен; возвращает сам токен для ссылки. */
export async function issueLoginToken(
  ctx: TenantContext,
  username: string,
  now = Date.now(),
): Promise<string> {
  const token = newLoginToken();
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${TG_LOGIN_PREFIX}${tokenHash(token)}`,
    value: JSON.stringify({ username, exp: now + TG_LOGIN_TTL_MS }),
  });
  if (error) throw new Error(`вход через Telegram: ${error.message}`);
  return token;
}

/** Погасить токен: логин владельца или null — нет, чужой, истёк или уже использован. */
export async function consumeLoginToken(
  ctx: TenantContext,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const { data } = await ctx.db
    .from("app_settings")
    .delete()
    .eq("key", `${TG_LOGIN_PREFIX}${tokenHash(token)}`)
    .select("value");
  const row = (data ?? [])[0] as { value: string | null } | undefined;
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as { username?: unknown; exp?: unknown };
    if (typeof v.username !== "string" || typeof v.exp !== "number" || v.exp < now) return null;
    return v.username;
  } catch {
    return null;
  }
}
