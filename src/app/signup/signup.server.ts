import { createHash } from "node:crypto";
import { serviceDb } from "@/core/db/client.server";

/**
 * Лимит самостоятельной регистрации. Схему не трогаем: регистрации и так
 * пишутся в bot_events (kind=onboard, actor=signup), отпечаток адреса кладём
 * в payload. Капчи нет, поэтому лимит — главная защита открытой формы.
 */
export const SIGNUP_LIMITS = { perIpPerDay: 2, totalPerDay: 20 } as const;

/** Адрес в журнал — не как есть, а 16 байт sha256. */
export function ipHash(ip: string | null): string {
  return createHash("sha256")
    .update(`ff-signup\0${ip ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);
}

export function signupVerdict(counts: { ip: number; total: number }): string | null {
  if (counts.ip >= SIGNUP_LIMITS.perIpPerDay)
    return "С этого адреса уже зарегистрированы магазины. Попробуйте завтра или напишите нам.";
  if (counts.total >= SIGNUP_LIMITS.totalPerDay)
    return "Регистрация на сегодня временно закрыта. Попробуйте завтра или напишите нам.";
  return null;
}

/** null — можно регистрировать; иначе текст отказа. Ошибка базы — отказ. */
export async function signupRefusal(hash: string): Promise<string | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const base = () =>
    serviceDb()
      .from("bot_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "onboard")
      .eq("actor", "signup")
      .gte("at", since);
  const [byIp, total] = await Promise.all([base().eq("payload->>ip_hash", hash), base()]);
  if (byIp.error || total.error) return "Регистрация временно недоступна. Попробуйте позже.";
  return signupVerdict({ ip: byIp.count ?? 0, total: total.count ?? 0 });
}
