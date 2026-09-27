import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { WebAppUser } from "./init-data";

/**
 * Вход покупателя на витрину через Telegram. Кнопку рисует виджет Telegram
 * от бота магазина; вернувшиеся поля подписаны ключом sha256(токен бота) —
 * так проверяет подпись сервер, для каждого магазина своим токеном. После
 * входа покупатель держит подписанную cookie этого магазина: в ней только
 * id в Telegram, срок и подпись, привязанная к магазину и к токену бота.
 */

/** Данные виджета старше суток не принимаем: перехваченная ссылка входа быстро протухает. */
export const LOGIN_MAX_AGE_SEC = 24 * 3600;
/** Сколько держится вход на витрине. */
export const BUYER_SESSION_SEC = 30 * 24 * 3600;

export type LoginResult =
  | { ok: true; user: WebAppUser; authDate: number }
  | { ok: false; reason: "invalid" | "expired" | "no_user" };

function sameHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Проверка данных Telegram Login Widget
 * (core.telegram.org/widgets/login#checking-authorization): строка из всех
 * полей, кроме hash, по алфавиту через перевод строки, HMAC-SHA256 с ключом
 * sha256(токен). Сравнение — за постоянное время.
 */
export function validateLoginWidget(
  fields: Record<string, string>,
  botToken: string,
  maxAgeSec = LOGIN_MAX_AGE_SEC,
  now = Math.floor(Date.now() / 1000),
): LoginResult {
  const hash = fields.hash ?? "";
  const pairs = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const key = createHash("sha256").update(botToken).digest();
  const calc = createHmac("sha256", key).update(pairs.join("\n")).digest("hex");
  if (!sameHex(calc, hash)) return { ok: false, reason: "invalid" };
  const authDate = Number(fields.auth_date);
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: "invalid" };
  // Часы Telegram и наши расходятся на секунды, не на минуты.
  if (now - authDate > maxAgeSec || authDate - now > 300) return { ok: false, reason: "expired" };
  const id = Number(fields.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "no_user" };
  return {
    ok: true,
    authDate,
    user: {
      id,
      first_name: fields.first_name,
      last_name: fields.last_name,
      username: fields.username,
    },
  };
}

/** Подписать поля так же, как Telegram, — для тестов. */
export function signLoginWidget(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const key = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", key).update(pairs.join("\n")).digest("hex");
}

/**
 * Отпечаток токена бота: сменил продавец токен — отпечаток другой, и все
 * входы, выданные раньше, перестают действовать. Сам токен в cookie не попадает.
 */
export function botTokenStamp(botToken: string): string {
  return createHash("sha256").update(`ff-tg-login-token\0${botToken}`).digest("hex").slice(0, 32);
}

/** Своя cookie у каждого магазина: вход в одном магазине не открывает другой. */
export function buyerCookieName(botId: string): string {
  return `ff_tg_${botId.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;
}

function sessionMac(secret: string, botId: string, stamp: string, tgId: number, exp: number) {
  return createHmac("sha256", secret)
    .update(`ff-tg-buyer\0${botId}\0${stamp}\0${tgId}\0${exp}`)
    .digest("hex");
}

/** Значение cookie: `<id>.<срок>.<подпись>`. */
export function signBuyerSession(
  secret: string,
  botId: string,
  stamp: string,
  telegramId: number,
  now = Math.floor(Date.now() / 1000),
): string {
  const exp = now + BUYER_SESSION_SEC;
  return `${telegramId}.${exp}.${sessionMac(secret, botId, stamp, telegramId, exp)}`;
}

/** id покупателя в Telegram из cookie или null: чужой магазин, чужой токен, срок, подделка. */
export function verifyBuyerSession(
  secret: string,
  botId: string,
  stamp: string,
  value: string | null | undefined,
  now = Math.floor(Date.now() / 1000),
): number | null {
  const m = /^(\d{1,20})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!m) return null;
  const tgId = Number(m[1]);
  const exp = Number(m[2]);
  if (!Number.isSafeInteger(tgId) || tgId <= 0 || exp <= now) return null;
  return sameHex(sessionMac(secret, botId, stamp, tgId, exp), m[3]!) ? tgId : null;
}
