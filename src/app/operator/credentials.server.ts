import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { hashPassword, verifyPassword } from "@/app/auth/password";
import { timingSafeSecretEqual } from "@/lib/safe-equal";
import { serverFailure } from "@/lib/server-failure";

/**
 * Учётка оператора живёт в базе (operator_settings: operator_username,
 * operator_password_hash — scrypt), а не в окружении деплоя. Переменные
 * OPERATOR_USERNAME/OPERATOR_PASSWORD остались только как запасной вход,
 * пока в базе ничего нет: первый вход по ним, дальше — смена в панели.
 */
const KEY_USER = "operator_username";
const KEY_HASH = "operator_password_hash";
/** Секрет двухшагового входа (two-factor.server.ts) — часть отпечатка сессии. */
const TOTP_SECRET = "operator_totp_secret";
/**
 * Эпоха сессий оператора: случайная строка, новая при каждом включении и
 * выключении двухшагового входа. Без неё отпечаток после выключения снова
 * совпал бы с тем, что был до включения, и украденная тогда cookie ожила бы.
 * Пока строки нет (до первого включения), отпечаток прежний — деплой никого
 * не выкидывает. При восстановлении доступа (docs/OPERATOR-2FA.md) не удаляется.
 */
export const SESSION_EPOCH = "operator_session_epoch";

async function readSettings(): Promise<Record<string, string>> {
  const { data, error: readErr2 } = await serviceDb()
    .from("operator_settings")
    .select("key, value")
    .in("key", [KEY_USER, KEY_HASH, TOTP_SECRET, SESSION_EPOCH]);
  if (readErr2) throw serverFailure(`[operator] учётные данные не прочитаны: ${readErr2.message}`);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.value) out[r.key] = r.value;
  return out;
}

export type OperatorCredentialsSource = "database" | "environment" | "none";

export async function operatorCredentialsSource(): Promise<{
  source: OperatorCredentialsSource;
  username: string | null;
}> {
  const s = await readSettings();
  if (s[KEY_USER] && s[KEY_HASH]) return { source: "database", username: s[KEY_USER] };
  const e = env();
  if (e.OPERATOR_USERNAME && e.OPERATOR_PASSWORD)
    return { source: "environment", username: e.OPERATOR_USERNAME };
  return { source: "none", username: null };
}

/** Логин оператора — чтобы общая форма входа поняла, чьи это данные. */
export async function isOperatorUsername(username: string): Promise<boolean> {
  const { username: current } = await operatorCredentialsSource();
  return Boolean(current) && timingSafeSecretEqual(username.trim(), current!);
}

export async function verifyOperator(username: string, password: string): Promise<boolean> {
  const s = await readSettings();
  if (s[KEY_USER] && s[KEY_HASH])
    return (
      timingSafeSecretEqual(username.trim(), s[KEY_USER]) && verifyPassword(password, s[KEY_HASH])
    );
  const e = env();
  if (!e.OPERATOR_USERNAME || !e.OPERATOR_PASSWORD) return false;
  return (
    timingSafeSecretEqual(username.trim(), e.OPERATOR_USERNAME) &&
    timingSafeSecretEqual(password, e.OPERATOR_PASSWORD)
  );
}

/**
 * Отпечаток текущей учётки оператора для сессии. Смена логина или пароля в
 * панели (или в окружении) выкидывает все ранее выданные сессии оператора.
 */
export async function operatorStamp(): Promise<string | null> {
  const { credentialStamp } = await import("@/app/auth/session.server");
  const s = await readSettings();
  // Включение и выключение двухшагового входа гасит прежние сессии, как смена
  // пароля: меняется эпоха (SESSION_EPOCH). Обе части — только если строки есть.
  const extra = [s[SESSION_EPOCH], s[TOTP_SECRET]].filter((v): v is string => Boolean(v));
  if (s[KEY_USER] && s[KEY_HASH]) return credentialStamp("db", s[KEY_USER], s[KEY_HASH], ...extra);
  const e = env();
  if (e.OPERATOR_USERNAME && e.OPERATOR_PASSWORD)
    return credentialStamp("env", e.OPERATOR_USERNAME, e.OPERATOR_PASSWORD, ...extra);
  return null;
}

async function upsert(key: string, value: string): Promise<void> {
  const db = serviceDb();
  const { data, error: readErr } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (readErr) throw serverFailure(`[operator] настройка не прочитана: ${readErr.message}`);
  const { error } = data
    ? await db.from("operator_settings").update({ value }).eq("key", key)
    : await db.from("operator_settings").insert({ key, value });
  if (error) throw serverFailure(error.message);
}

/** Новая эпоха: все выданные ранее сессии оператора перестают действовать. */
export async function rotateOperatorSessions(): Promise<void> {
  const { randomBytes } = await import("node:crypto");
  await upsert(SESSION_EPOCH, randomBytes(16).toString("base64url"));
}

export async function setOperatorCredentials(username: string, password: string): Promise<void> {
  const u = username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,40}$/.test(u))
    throw new Error("Логин: латиница, цифры, точка, дефис, подчёркивание, от 3 до 40 символов.");
  if (password.length < 10) throw new Error("Пароль не короче 10 символов.");
  await upsert(KEY_USER, u);
  await upsert(KEY_HASH, hashPassword(password));
}
