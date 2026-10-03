import { createHash } from "node:crypto";
import { REFRESH } from "./challenge";
import { SIGNUP_UNAVAILABLE } from "./refusals";
import { serviceDb } from "@/core/db/client.server";
import { SIGNUP_CHALLENGE_PREFIX, pruneSignupChallenges } from "@/core/retention/retention";

/**
 * Лимит самостоятельной регистрации. Схему не трогаем: регистрации и так
 * пишутся в bot_events (kind=onboard, actor=signup), отпечаток адреса кладём
 * в payload. Вместе с задачей для браузера (challenge.ts) и полем-приманкой
 * это защита открытой формы от ботов.
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
export async function signupRefusal(hash: string, nonce?: string): Promise<string | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const base = () =>
    serviceDb()
      .from("bot_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "onboard")
      .eq("actor", "signup")
      .gte("at", since);
  const [byIp, total, reused] = await Promise.all([
    base().eq("payload->>ip_hash", hash),
    base(),
    nonce ? base().eq("payload->>challenge", nonce) : Promise.resolve({ error: null, count: 0 }),
  ]);
  if (byIp.error || total.error || reused.error) return SIGNUP_UNAVAILABLE;
  if ((reused.count ?? 0) > 0) return REFRESH;
  return signupVerdict({ ip: byIp.count ?? 0, total: total.count ?? 0 });
}

export const CHALLENGE_PREFIX = SIGNUP_CHALLENGE_PREFIX;

/**
 * Бронь решённой задачи до создания магазина: вставка строки
 * `operator_settings` с ключом `signup_challenge:<nonce>`. Ключ уникален,
 * поэтому из двух одновременных отправок с одним решением проходит одна —
 * проверка по журналу регистраций этого не ловила: обе успевали её пройти,
 * пока ни одна не записала событие. Просроченные брони подчищаются.
 */
export async function claimChallenge(nonce: string, now = Date.now()): Promise<string | null> {
  const db = serviceDb();
  const { error } = await db.from("operator_settings").insert({
    key: `${CHALLENGE_PREFIX}${nonce}`,
    value: new Date(now + 24 * 3600_000).toISOString(),
  });
  if (error?.code === "23505") return REFRESH;
  if (error) return SIGNUP_UNAVAILABLE;
  await pruneSignupChallenges(now).catch(() => undefined);
  return null;
}
