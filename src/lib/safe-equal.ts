import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Сравнение двух секретов за постоянное время и без утечки длины: сравниваются
 * их SHA-256. Для заголовков и токенов, где длина пришедшего значения не нужна.
 */
export function timingSafeSecretEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
