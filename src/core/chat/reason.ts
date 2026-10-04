/**
 * «Почему бот так ответил»: короткая причина ответа в журнале диалога, вид
 * `step=cart parsed=codes skipped=phone`. Не больше REASON_MAX знаков, только
 * служебные слова из букв, цифр и `_.:-`: текст покупателя сюда попасть не
 * может, как бы ни был построен вызов.
 */
export const REASON_MAX = 120;
const TOKEN_VALUE_MAX = 24;

export type ReasonParts = Record<string, string | number | boolean | null | undefined>;

const word = (v: string) => v.toLowerCase().replace(/[^a-z0-9_.:-]/g, "");

/** Причина из пар ключ-значение; пустое и лишнее отбрасывается, сверх предела — хвост пропадает. */
export function makeReason(parts: ReasonParts): string | null {
  const out: string[] = [];
  let len = 0;
  for (const [k, raw] of Object.entries(parts)) {
    if (raw === undefined || raw === null || raw === false) continue;
    const key = word(k).slice(0, 16);
    const value = raw === true ? "1" : word(String(raw)).slice(0, TOKEN_VALUE_MAX);
    if (!key || !value) continue;
    const token = `${key}=${value}`;
    if (len + token.length + (out.length ? 1 : 0) > REASON_MAX) break;
    out.push(token);
    len += token.length + (out.length > 1 ? 1 : 0);
  }
  return out.length ? out.join(" ") : null;
}

/** Строка из базы или от вызывающего → безопасная причина (или null). */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts: ReasonParts = {};
  for (const token of raw.split(/\s+/)) {
    const i = token.indexOf("=");
    if (i > 0) parts[token.slice(0, i)] = token.slice(i + 1);
  }
  return makeReason(parts);
}

/** Пары для показа продавцу. */
export function reasonPairs(raw: string | null | undefined): Array<{ key: string; value: string }> {
  const clean = cleanReason(raw);
  if (!clean) return [];
  return clean.split(" ").map((t) => {
    const i = t.indexOf("=");
    return { key: t.slice(0, i), value: t.slice(i + 1) };
  });
}
