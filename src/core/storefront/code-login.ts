import { createHmac, randomBytes, randomInt } from "node:crypto";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimStateSection, type Customer } from "@/core/customers/customers";

/**
 * Вход покупателя на витрину по одноразовому коду (В5). Почта ничего не
 * открывает, поэтому владение доказывает бот магазина, где покупатель уже есть:
 *
 *  1. Сайт выдаёт браузеру случайную метку (nonce, живёт в cookie) и ссылку в бот
 *     с этой меткой: t.me/<бот>?start=lg_<метка> или сообщение «вход <метка>».
 *  2. Бот по метке пишет покупателю шестизначный код. В базе остаются только
 *     отпечатки метки и кода (HMAC серверным ключом), сам код — только в чате.
 *  3. Покупатель вводит код на сайте; сервер по метке из cookie находит его
 *     запись и проверяет код: один раз, не больше 5 попыток, 10 минут.
 *
 * Код привязан к метке браузера: чужой браузер без метки код не подберёт, а
 * перебор ограничен пятью попытками на код. «Использован» ставит условная запись
 * (`claimStateSection`, версия `rev`) до выдачи входа: два одновременных ввода
 * верного кода пропустят только один. Запись лежит в `bot_users.state.web_login`,
 * схема базы не меняется.
 */
export const LOGIN_CODE_TTL_MS = 10 * 60_000;
export const LOGIN_MAX_TRIES = 5;
/** Новый код на ту же метку — не чаще раза в 30 секунд (защита от залпа сообщений в бот). */
export const LOGIN_REISSUE_MS = 30_000;
export const LOGIN_START_PREFIX = "lg_";

const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;

/** Новая метка браузера: 16 случайных байт, 22 знака base64url. */
export function newLoginNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function validNonce(v: unknown): v is string {
  return typeof v === "string" && NONCE_RE.test(v);
}

/** Метка из текста «вход <метка>» или из параметра /start; иначе null. */
export function nonceFromPayload(payload: string): string | null {
  if (!payload.startsWith(LOGIN_START_PREFIX)) return null;
  const n = payload.slice(LOGIN_START_PREFIX.length);
  return validNonce(n) ? n : null;
}

const WORD = /^(?:вход|кіру|kirish|login)\s+([A-Za-z0-9_-]{22})$/i;
/** Сообщение «вход <метка>» в Instagram/WhatsApp; иначе null. */
export function nonceFromMessage(text: string): string | null {
  return WORD.exec(text.trim())?.[1] ?? null;
}

function mac(secret: string, botId: string, kind: "n" | "c", ...parts: string[]): string {
  return createHmac("sha256", secret)
    .update(`ff-code-login\0${kind}\0${botId}\0${parts.join("\0")}`)
    .digest("hex")
    .slice(0, 40);
}
export const nonceHash = (secret: string, botId: string, nonce: string) =>
  mac(secret, botId, "n", nonce);
const codeHash = (secret: string, botId: string, nonce: string, code: string) =>
  mac(secret, botId, "c", nonce, code);

/** `customer` — покупатель со свежим состоянием: дальнейшие записи диалога не должны затереть запись входа. */
export type Issued =
  | { ok: true; code: string; ttlMin: number; customer: Customer }
  | { ok: false; reason: "wait" | "bad_nonce" };

/**
 * Выдать код покупателю по метке. Новая метка (другой браузер) заменяет старый
 * код, повтор той же метки раньше чем через 30 секунд — «подождите».
 */
export async function issueLoginCode(
  ctx: TenantContext,
  secret: string,
  customer: Customer,
  nonce: string,
  now = Date.now(),
): Promise<Issued> {
  if (!validNonce(nonce)) return { ok: false, reason: "bad_nonce" };
  const botId = ctx.tenant.id;
  const n = nonceHash(secret, botId, nonce);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  let tooSoon = false;
  const written = await claimStateSection(ctx, customer, "web_login", (cur) => {
    if (cur.n === n && typeof cur.at === "number" && now - cur.at < LOGIN_REISSUE_MS) {
      tooSoon = true;
      return null;
    }
    return {
      n,
      c: codeHash(secret, botId, nonce, code),
      exp: now + LOGIN_CODE_TTL_MS,
      at: now,
      tries: 0,
    };
  });
  if (!written) return tooSoon ? { ok: false, reason: "wait" } : { ok: false, reason: "bad_nonce" };
  return { ok: true, code, ttlMin: LOGIN_CODE_TTL_MS / 60_000, customer: written };
}

export type LoginCheck =
  | { ok: true; telegramId: number }
  /** unknown — метки нет (код не запрошен или метка не та); wrong — неверный код, `left` попыток осталось. */
  | { ok: false; reason: "unknown" | "expired" | "used" | "locked" }
  | { ok: false; reason: "wrong"; left: number };

/** Код введён на сайте: проверка и «использован» одной условной записью. */
export async function checkLoginCode(
  ctx: TenantContext,
  secret: string,
  nonce: string,
  code: string,
  now = Date.now(),
): Promise<LoginCheck> {
  if (!validNonce(nonce) || !/^\d{6}$/.test(code)) return { ok: false, reason: "unknown" };
  const botId = ctx.tenant.id;
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("user_key, telegram_id, platform")
    .eq("state->web_login->>n", nonceHash(secret, botId, nonce));
  if (error) throw serverFailure(`Вход по коду: не удалось найти покупателя: ${error.message}`);
  // Метка случайная на 128 бит: две записи с одной меткой невозможны, но не угадываем.
  if (!data || data.length !== 1) return { ok: false, reason: "unknown" };
  const row = data[0]!;
  const customer = { userKey: row.user_key, telegramId: row.telegram_id } as Customer;
  const want = codeHash(secret, botId, nonce, code);
  let outcome: LoginCheck = { ok: false, reason: "unknown" };
  const written = await claimStateSection(ctx, customer, "web_login", (cur) => {
    if (cur.n !== nonceHash(secret, botId, nonce)) {
      outcome = { ok: false, reason: "unknown" };
      return null;
    }
    if (cur.used) {
      outcome = { ok: false, reason: "used" };
      return null;
    }
    if (typeof cur.exp !== "number" || now > cur.exp) {
      outcome = { ok: false, reason: "expired" };
      return null;
    }
    const tries = typeof cur.tries === "number" ? cur.tries : 0;
    if (tries >= LOGIN_MAX_TRIES) {
      outcome = { ok: false, reason: "locked" };
      return null;
    }
    if (cur.c === want) {
      outcome = { ok: true, telegramId: row.telegram_id };
      return { ...cur, used: true, tries: tries + 1 };
    }
    outcome = { ok: false, reason: "wrong", left: LOGIN_MAX_TRIES - tries - 1 };
    return { ...cur, tries: tries + 1 };
  });
  // Неверный код тоже пишет (счётчик попыток), поэтому «записано» не значит «вошёл».
  void written;
  return outcome;
}
