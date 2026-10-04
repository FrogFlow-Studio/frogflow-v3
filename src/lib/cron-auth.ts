import { timingSafeSecretEqual } from "@/lib/safe-equal";

/** Vercel Cron присылает Authorization: Bearer $CRON_SECRET. */
export function isCronAuthorized(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  return timingSafeSecretEqual(token, secret);
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
