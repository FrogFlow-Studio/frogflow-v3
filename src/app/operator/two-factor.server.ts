import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { decryptSecret, encryptSecret } from "@/core/secrets/vault";
import {
  hashBackupCode,
  newBackupCodes,
  newTotpSecret,
  otpauthUri,
  useBackupCode,
  verifyTotp,
} from "@/core/auth/totp";
import { serverFailure } from "@/lib/server-failure";

/**
 * Двухшаговый вход оператора: код из приложения-аутентификатора после пароля.
 * По умолчанию выключен. Всё в operator_settings (схема не меняется):
 *
 *   operator_totp_secret     — секрет, зашифрованный SECRETS_KEY; есть строка —
 *                              вход требует код;
 *   operator_totp_pending    — секрет на время включения, до первого верного кода;
 *   operator_totp_last_step  — шаг последнего принятого кода (повтор не пускает);
 *   operator_backup_codes    — JSON-массив хэшей резервных кодов.
 *
 * Запереть себя нельзя: секрет становится рабочим только после верного кода
 * из приложения, и тут же выдаются резервные коды. Если потеряны и телефон,
 * и резервные коды — docs/OPERATOR-2FA.md (удалить строку operator_totp_secret).
 */
export const TOTP_KEYS = {
  secret: "operator_totp_secret",
  pending: "operator_totp_pending",
  lastStep: "operator_totp_last_step",
  backup: "operator_backup_codes",
} as const;

/** Сколько живёт незавершённое включение: QR отсканировали и отвлеклись. */
const PENDING_TTL_MS = 15 * 60 * 1000;

async function read(keys: string[]): Promise<Record<string, string>> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("key, value")
    .in("key", keys);
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.value) out[r.key] = r.value;
  return out;
}

async function write(key: string, value: string): Promise<void> {
  const db = serviceDb();
  const { data, error: readErr } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (readErr) throw serverFailure(`[2fa] настройка не прочитана: ${readErr.message}`);
  const { error } = data
    ? await db.from("operator_settings").update({ value }).eq("key", key)
    : await db.from("operator_settings").insert({ key, value });
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
}

/** Замена значения, только если оно всё ещё `prev`: два входа одним кодом не пройдут. */
async function swap(key: string, prev: string, next: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .update({ value: next })
    .eq("key", key)
    .eq("value", prev)
    .select("key");
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
  return (data ?? []).length > 0;
}

async function remove(keys: string[]): Promise<void> {
  const { error } = await serviceDb().from("operator_settings").delete().in("key", keys);
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
}

const secretKey = () => env().SECRETS_KEY;

function parseHashes(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type TwoFactorStatus = { enabled: boolean; backupLeft: number };

/** Неверный код при выключении или замене резервных — копится в замок входа. */
export class BadSecondFactor extends Error {
  constructor() {
    super("Код не подошёл.");
  }
}

export async function twoFactorStatus(): Promise<TwoFactorStatus> {
  const s = await read([TOTP_KEYS.secret, TOTP_KEYS.backup]);
  return {
    enabled: Boolean(s[TOTP_KEYS.secret]),
    backupLeft: s[TOTP_KEYS.secret] ? parseHashes(s[TOTP_KEYS.backup]).length : 0,
  };
}

/**
 * Начать включение: новый секрет ждёт подтверждения кодом. Вход пока
 * по-прежнему без кода — ничего не сломается, если оператор бросит на полпути.
 */
export async function startTwoFactorSetup(
  account: string,
  now = Date.now(),
): Promise<{ secret: string; uri: string; qrSvg: string }> {
  if ((await twoFactorStatus()).enabled) throw new Error("Двухшаговый вход уже включён.");
  const secret = newTotpSecret();
  await write(
    TOTP_KEYS.pending,
    JSON.stringify({ enc: encryptSecret(secret, secretKey()), at: now }),
  );
  const uri = otpauthUri(secret, account);
  const { qrSvg } = await import("@/core/billing/pay/kaspi-link");
  return { secret, uri, qrSvg: qrSvg(uri) };
}

/**
 * Подтвердить включение кодом из приложения. Только здесь секрет становится
 * рабочим; возвращает резервные коды — их показываем один раз.
 */
export async function confirmTwoFactorSetup(code: string, now = Date.now()): Promise<string[]> {
  const s = await read([TOTP_KEYS.pending, TOTP_KEYS.secret]);
  if (s[TOTP_KEYS.secret]) throw new Error("Двухшаговый вход уже включён.");
  let pending: { enc?: string; at?: number } = {};
  try {
    pending = JSON.parse(s[TOTP_KEYS.pending] ?? "{}") as typeof pending;
  } catch {
    pending = {};
  }
  if (!pending.enc || typeof pending.at !== "number" || now - pending.at > PENDING_TTL_MS)
    throw new Error("Время на включение вышло. Начните заново и отсканируйте новый QR-код.");
  const secret = decryptSecret(pending.enc, secretKey());
  const step = verifyTotp(secret, code, now);
  if (step === null)
    throw new Error("Код не подошёл. Проверьте время на телефоне и введите новый код.");
  // Двойное подтверждение (два клика, две вкладки): включает только тот, кто
  // забрал незавершённое включение, иначе на экране остались бы чужие коды.
  const { data: claimed, error } = await serviceDb()
    .from("operator_settings")
    .delete()
    .eq("key", TOTP_KEYS.pending)
    .eq("value", s[TOTP_KEYS.pending]!)
    .select("key");
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
  if (!claimed?.length) throw new Error("Двухшаговый вход уже включается в другом окне.");
  const codes = newBackupCodes();
  // Порядок важен: сначала коды и шаг, секрет последним — он и включает защиту.
  await write(TOTP_KEYS.backup, JSON.stringify(codes.map(hashBackupCode)));
  await write(TOTP_KEYS.lastStep, String(step));
  await write(TOTP_KEYS.secret, pending.enc);
  await (await import("./credentials.server")).rotateOperatorSessions();
  return codes;
}

/**
 * Второй шаг: код из приложения или резервный код (он сгорает). Возвращает,
 * чем вошли, или null. Выключенный двухшаговый вход — «none», код не нужен.
 */
export async function verifySecondFactor(
  code: string | undefined,
  now = Date.now(),
): Promise<"none" | "totp" | "backup" | null> {
  const s = await read([TOTP_KEYS.secret, TOTP_KEYS.lastStep, TOTP_KEYS.backup]);
  const enc = s[TOTP_KEYS.secret];
  if (!enc) return "none";
  const c = (code ?? "").trim();
  if (!c) return null;
  if (/^\d[\d\s]*$/.test(c)) {
    const prevRaw = s[TOTP_KEYS.lastStep] ?? "";
    const last = /^\d+$/.test(prevRaw) ? Number(prevRaw) : null;
    const step = verifyTotp(decryptSecret(enc, secretKey()), c, now, last);
    if (step === null) return null;
    // Тот же код в двух параллельных запросах: пройдёт только первый.
    const ok = prevRaw
      ? await swap(TOTP_KEYS.lastStep, prevRaw, String(step))
      : (await write(TOTP_KEYS.lastStep, String(step)), true);
    return ok ? "totp" : null;
  }
  const prev = s[TOTP_KEYS.backup] ?? "[]";
  const left = useBackupCode(parseHashes(prev), c);
  if (!left) return null;
  return (await swap(TOTP_KEYS.backup, prev, JSON.stringify(left))) ? "backup" : null;
}

/** Выключить: только с верным кодом (из приложения или резервным). */
export async function disableTwoFactor(code: string, now = Date.now()): Promise<void> {
  const r = await verifySecondFactor(code, now);
  if (r === "none") throw new Error("Двухшаговый вход и так выключен.");
  if (!r) throw new BadSecondFactor();
  await remove([TOTP_KEYS.secret, TOTP_KEYS.lastStep, TOTP_KEYS.backup, TOTP_KEYS.pending]);
  // Новая эпоха: сессии, выданные до включения, не оживают после выключения.
  await (await import("./credentials.server")).rotateOperatorSessions();
}

/** Новые резервные коды взамен старых — по верному коду. */
export async function regenerateBackupCodes(code: string, now = Date.now()): Promise<string[]> {
  const r = await verifySecondFactor(code, now);
  if (r === "none") throw new Error("Сначала включите двухшаговый вход.");
  if (!r) throw new BadSecondFactor();
  const codes = newBackupCodes();
  await write(TOTP_KEYS.backup, JSON.stringify(codes.map(hashBackupCode)));
  return codes;
}
