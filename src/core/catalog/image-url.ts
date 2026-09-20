/**
 * Адрес витринной картинки: /api/img/<bot_id>/<ключ в base64url>.
 * Ключ кодируется, а не вставляется как есть: с расширением «.png» dev-сервер
 * Vite считает путь статикой и не отдаёт его приложению, а ключи без
 * префикса bot_id (первый клиент) и с ним должны давать один формат адреса.
 * Без Buffer: модуль нужен и в браузере (админка), и на сервере.
 */
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeImageKey(botId: string, key: string): string {
  const prefix = `${botId}/`;
  return toBase64Url(key.startsWith(prefix) ? key.slice(prefix.length) : key);
}

export function decodeImageKey(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(encoded)) return null;
  try {
    const rel = fromBase64Url(encoded);
    if (!rel || rel.includes("..") || rel.startsWith("/")) return null;
    return rel;
  } catch {
    return null;
  }
}

export function imagePath(botId: string, key: string): string {
  return `/api/img/${botId}/${encodeImageKey(botId, key)}`;
}
