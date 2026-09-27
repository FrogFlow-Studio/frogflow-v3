/**
 * Решение задачи регистрации в браузере (WebCrypto, без зависимостей).
 * Ищем такое число, чтобы sha256(«задача:число») начинался с POW_BITS
 * нулевых бит: браузер тратит на это доли секунды, а скрипту, который шлёт
 * формы пачками, приходится считать на каждую регистрацию.
 */
export const POW_BITS = 16;

/** Раньше этого после выдачи задачи форму не принимают: человек так быстро не заполняет. */
export const CHALLENGE_MIN_FILL_MS = 3_000;

export function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

export async function solveChallenge(challenge: string, bits = POW_BITS): Promise<string> {
  const enc = new TextEncoder();
  for (let i = 0; ; i++) {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${challenge}:${i}`));
    if (leadingZeroBits(new Uint8Array(digest)) >= bits) return String(i);
  }
}
