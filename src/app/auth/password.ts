import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt-хеш пароля: `scrypt:<salt>:<hash>` в base64url. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, saltS, hashS] = stored.split(":");
  if (algo !== "scrypt" || !saltS || !hashS) return false;
  const expected = Buffer.from(hashS, "base64url");
  const actual = scryptSync(
    password.normalize("NFKC"),
    Buffer.from(saltS, "base64url"),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
