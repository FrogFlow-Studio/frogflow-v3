import { getRequestIP } from "@tanstack/react-start/server";
import { serviceDb } from "@/core/db/client.server";

const WINDOW_MIN = 15;
const MAX_FAILURES = 5;

/**
 * Адрес клиента. Серверные функции берут его из контекста запроса; обработчик
 * маршрута API передаёт свой Request — на Vercel x-forwarded-for ставит сама
 * платформа, первый адрес в нём — клиент.
 */
export function clientIp(request?: Request): string | null {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    /* вне контекста запроса — смотрим заголовки */
  }
  const h = request?.headers;
  const fwd = h?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h?.get("x-real-ip")?.trim() || null;
}

/**
 * Антибрут: пять неудач за 15 минут с одного адреса — пауза. Запросы без
 * адреса считаются одним общим адресом, а не проходят без счёта. Ошибка базы
 * не запирает вход.
 */
export async function loginLocked(
  scope: "operator" | { botId: string },
  ip: string | null,
): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const db = serviceDb();
  const q =
    scope === "operator"
      ? db
          .from("operator_login_attempts")
          .select("id", { count: "exact", head: true })
          .eq("ok", false)
          .gte("at", since)
      : db
          .from("admin_login_attempts")
          .select("id", { count: "exact", head: true })
          .eq("ok", false)
          .eq("bot_id", scope.botId)
          .gte("at", since);
  const { count, error } = await (ip ? q.eq("ip", ip) : q.is("ip", null));
  if (error) return false;
  return (count ?? 0) >= MAX_FAILURES;
}

export async function recordLogin(
  scope: "operator" | { botId: string },
  ip: string | null,
  ok: boolean,
  username: string,
): Promise<void> {
  const db = serviceDb();
  if (scope === "operator") await db.from("operator_login_attempts").insert({ ip, ok, username });
  else await db.from("admin_login_attempts").insert({ bot_id: scope.botId, ip, ok });
}

export const loginDelay = () => new Promise((r) => setTimeout(r, 300));
