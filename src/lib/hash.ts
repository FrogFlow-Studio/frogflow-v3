import { createHash } from "node:crypto";

/**
 * SHA-256 в hex, при `length` — первые `length` символов. Одна функция вместо
 * `createHash("sha256").update(x).digest("hex").slice(0, n)`, который был
 * размножен по коду: ключи отметок, хеши адреса и устройства, токены ссылок.
 */
export function sha256Hex(data: string | Uint8Array, length?: number): string {
  const hex = createHash("sha256").update(data).digest("hex");
  return length === undefined ? hex : hex.slice(0, length);
}
