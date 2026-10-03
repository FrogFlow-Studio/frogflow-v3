import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CHALLENGE_MIN_FILL_MS, POW_BITS, leadingZeroBits } from "./challenge-solve";

export { CHALLENGE_MIN_FILL_MS, POW_BITS };

/**
 * Защита открытой регистрации от ботов без внешней капчи и ключей: страница
 * получает подписанную задачу («v1.время.отпечаток.подпись»), браузер решает
 * её (challenge-solve.ts), сервер проверяет подпись, возраст и решение.
 * Простой скрипт, который шлёт POST без браузера, не пройдёт; повтор одной
 * задачи закрывает отпечаток в журнале регистраций (signup.server).
 */
export const CHALLENGE_MAX_AGE_MS = 2 * 3600_000;

export const REFRESH = "Проверка устарела — обновите страницу и попробуйте ещё раз.";
export const CHALLENGE_TOO_FAST = "Слишком быстро — проверьте поля и отправьте ещё раз.";

/**
 * Назначение задачи входит в подпись: задачу регистрации не подсунуть в
 * оформление заказа на витрине и наоборот.
 */
export type ChallengePurpose = "signup" | "checkout";

function mac(secret: string, body: string, purpose: ChallengePurpose): string {
  return createHmac("sha256", secret)
    .update(`ff-${purpose}-challenge\0${body}`)
    .digest("hex")
    .slice(0, 32);
}

export function issueChallenge(
  secret: string,
  now = Date.now(),
  purpose: ChallengePurpose = "signup",
): string {
  const body = `v1.${now}.${randomBytes(16).toString("hex")}`;
  return `${body}.${mac(secret, body, purpose)}`;
}

function parse(
  challenge: string,
): { issued: number; nonce: string; body: string; sig: string } | null {
  const m = /^(v1\.(\d{10,16})\.([0-9a-f]{32}))\.([0-9a-f]{32})$/.exec(challenge);
  return m ? { body: m[1]!, issued: Number(m[2]), nonce: m[3]!, sig: m[4]! } : null;
}

/** Отпечаток задачи — пишется в журнал регистрации, чтобы задачу не решали один раз на много регистраций. */
export function challengeNonce(challenge: string): string | null {
  return parse(challenge)?.nonce ?? null;
}

/** null — проверка пройдена; иначе текст отказа для формы. */
export function verifyChallenge(
  secret: string,
  challenge: string | undefined,
  answer: string | undefined,
  now = Date.now(),
  /** Сложность; меньше — только в тестах, чтобы медленный CI не ждал десятки секунд. */
  bits = POW_BITS,
  purpose: ChallengePurpose = "signup",
): string | null {
  const c = parse(challenge ?? "");
  if (!c) return REFRESH;
  const want = Buffer.from(mac(secret, c.body, purpose));
  if (!timingSafeEqual(want, Buffer.from(c.sig))) return REFRESH;
  const age = now - c.issued;
  if (age > CHALLENGE_MAX_AGE_MS || age < -60_000) return REFRESH;
  if (age < CHALLENGE_MIN_FILL_MS) return CHALLENGE_TOO_FAST;
  if (!/^\d{1,12}$/.test(answer ?? "")) return REFRESH;
  const digest = createHash("sha256").update(`${challenge}:${answer}`).digest();
  if (leadingZeroBits(digest) < bits) return REFRESH;
  return null;
}
