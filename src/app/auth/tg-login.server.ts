import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

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
  if (error) throw serverFailure(`вход через Telegram: ${error.message}`);
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

/** Сколько ссылок входа магазин присылает за час: чужие запросы не должны засыпать владельца. */
export const TG_LOGIN_MAX_PER_HOUR = 5;
const TG_REQ_PREFIX = "admin_tg_req:";
const HOUR_MS = 3_600_000;

/**
 * Занять одну из TG_LOGIN_MAX_PER_HOUR ссылок часа для магазина (счёт на
 * магазин, а не на адрес, и отдельно от неудачных попыток пароля). Сначала
 * запись метки, потом счёт: два запроса разом не пройдут сверх предела.
 * false — предел исчерпан, ссылку слать не надо. Ошибка базы — исключение:
 * неизвестный счёт не должен пропускать поток запросов.
 */
export async function claimLoginRequest(ctx: TenantContext, now = Date.now()): Promise<boolean> {
  const key = `${TG_REQ_PREFIX}${String(now).padStart(15, "0")}:${randomBytes(6).toString("hex")}`;
  const { error } = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key, value: "1" });
  if (error) throw serverFailure(`вход через Telegram: ${error.message}`);
  const { data, error: readError } = await ctx.db
    .from("app_settings")
    .select("key")
    .eq("bot_id", ctx.tenant.id)
    .like("key", `${TG_REQ_PREFIX}%`)
    .order("key", { ascending: true });
  if (readError) throw serverFailure(`вход через Telegram: ${readError.message}`);
  const stamp = (k: string) => Number(k.slice(TG_REQ_PREFIX.length, TG_REQ_PREFIX.length + 15));
  const keys = (data ?? []).map((r) => r.key as string);
  const stale = keys.filter((k) => stamp(k) <= now - HOUR_MS);
  // Метки старше часа убираем; сбой уборки счёт не портит.
  if (stale.length > 0) await ctx.db.from("app_settings").delete().in("key", stale);
  const live = keys.filter((k) => stamp(k) > now - HOUR_MS);
  // Живых меток вместе со своей больше предела — отказ. При гонке отказать могут обоим: лучше меньше ссылок, чем больше.
  if (live.length <= TG_LOGIN_MAX_PER_HOUR) return true;
  await ctx.db.from("app_settings").delete().eq("key", key);
  return false;
}
