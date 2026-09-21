import { createHash, timingSafeEqual } from "node:crypto";

/** Vercel Cron присылает Authorization: Bearer $CRON_SECRET. */
export function isCronAuthorized(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function isBasicAuthorized(request: Request, username: string, password: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Basic ")) return false;
  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  const eq = (x: string, y: string) => {
    const a = createHash("sha256").update(x).digest();
    const b = createHash("sha256").update(y).digest();
    return timingSafeEqual(a, b);
  };
  return eq(u, username) && eq(p, password);
}

/** Разобрать Basic-заголовок — проверка самих данных остаётся вызывающему. */
export function basicCredentials(request: Request): { username: string; password: string } | null {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Basic ")) return null;
  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}
