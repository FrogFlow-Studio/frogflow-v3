import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "@/lib/hash";

/**
 * Одноразовые коды для двухшагового входа (RFC 6238, как в Google
 * Authenticator и любом другом приложении-аутентификаторе): HMAC-SHA1,
 * 6 цифр, шаг 30 секунд. Плюс резервные коды на случай потери телефона.
 * Чистые функции — без базы и без часов: время передаётся параметром.
 */

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
/** Сколько шагов назад и вперёд принимаем: часы телефона могут отставать. */
export const TOTP_DRIFT = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Ключ: только латиница A–Z и цифры 2–7");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет: 20 случайных байт (160 бит, как советует RFC 4226), base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Номер 30-секундного шага для момента `nowMs`. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, "0");
}

export function totpCode(secret: string, nowMs: number): string {
  return hotp(base32Decode(secret), totpStep(nowMs));
}

/**
 * Шаг, на котором код верен, или null. Шаг не старше `lastStep`: уже
 * использованный код (подсмотренный или перехваченный) второй раз не пускает.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  lastStep: number | null = null,
): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const now = totpStep(nowMs);
  for (let d = -TOTP_DRIFT; d <= TOTP_DRIFT; d++) {
    const step = now + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}

/** Ссылка для приложения-аутентификатора (её же рисуем QR-кодом). */
export function otpauthUri(secret: string, account: string, issuer = "FrogFlow"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* ── резервные коды ─────────────────────────────────────────────── */

export const BACKUP_CODES = 10;
// Без похожих символов (0/O, 1/I/L): код переписывают с бумаги.
const BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Нормализованный вид кода: без пробелов и дефисов, заглавными. */
export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

/** Коды вида XXXX-XXXX: показываем один раз, храним только хэши. */
export function newBackupCodes(n = BACKUP_CODES): string[] {
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(8);
    const s = [...bytes].map((b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

/**
 * Хэш резервного кода. 40 бит случайности на код и замок после пяти
 * неудачных попыток: перебор бесполезен, медленный scrypt не нужен.
 */
export function hashBackupCode(code: string): string {
  return sha256Hex(`frogflow-backup:${normalizeBackupCode(code)}`);
}

/** Оставшиеся хэши после использования кода или null, если кода нет среди них. */
export function useBackupCode(hashes: readonly string[], code: string): string[] | null {
  const h = hashBackupCode(code);
  const want = Buffer.from(h);
  // Строка не той длины (битая запись) — просто не совпадение, а не исключение.
  const i = hashes.findIndex((x) => {
    const have = Buffer.from(x);
    return have.length === want.length && timingSafeEqual(have, want);
  });
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
