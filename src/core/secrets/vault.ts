import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sha256Hex } from "@/lib/hash";

/**
 * Шифрование секретов клиентов в базе: AES-256-GCM, ключ платформы из
 * окружения (SECRETS_KEY), формат `enc:v1:<iv>:<tag>:<ciphertext>` в base64url.
 *
 * Почему v2 хранит токены в базе, хотя CONTROL-PLANE-PLAN §5.1 в v1 решил
 * «не хранить». Тот аргумент опирался на то, что у каждого клиента есть свой
 * деплой, который токен и так держит, — панели оставалось лишь попросить
 * деплой сделать действие. С одним деплоем этот деплой и есть панель:
 * токен обязан быть доступен коду по bot_id, иначе бот не ответит.
 *
 * Что это даёт против открытого текста: утечки одной базы недостаточно,
 * нужен ещё SECRETS_KEY из окружения. Что не даёт: тот, кто получил и то и
 * другое, получил всё. Поэтому ключ ротируется (префикс версии в формате
 * оставлен именно для этого), а дампы базы не ходят по рукам.
 */

const PREFIX = "enc:v1:";

function keyBytes(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b = Buffer.from(trimmed, "base64");
  if (b.length === 32) return b;
  throw new Error("SECRETS_KEY должен быть 32 байта: 64 hex-символа или base64");
}

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${b64u(iv)}:${b64u(tag)}:${b64u(ct)}`;
}

export function isEncryptedSecret(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function decryptSecret(stored: string, key: string): string {
  if (!isEncryptedSecret(stored)) {
    throw new Error("Секрет не зашифрован: ожидался формат enc:v1:…");
  }
  const [ivS, tagS, ctS] = stored.slice(PREFIX.length).split(":");
  if (!ivS || !tagS || !ctS) throw new Error("Повреждённый зашифрованный секрет");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), unb64u(ivS));
  decipher.setAuthTag(unb64u(tagS));
  return Buffer.concat([decipher.update(unb64u(ctS)), decipher.final()]).toString("utf8");
}

/** Отпечаток для журналов и диагностики — сам секрет никуда не попадает. */
export function secretFingerprint(secret: string | null | undefined): string {
  if (!secret) return "—";
  return sha256Hex(secret, 8);
}
