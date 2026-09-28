import { createHash, randomBytes } from "node:crypto";

/**
 * A/B-тест текста рассылки: аудитория делится пополам детерминированно —
 * по хешу группы теста и получателя, так что повтор отбора даёт те же
 * половины. Вариант A — одна рассылка, B — вторая, с тем же отбором и другим
 * текстом; сравниваются по доставке и нажатиям (core/broadcasts/clicks).
 */
export type AbMark = { group: string; half: 0 | 1 };

export function newAbGroup(): string {
  return randomBytes(6).toString("hex");
}

export function abHalf(recipient: number | string, group: string): 0 | 1 {
  const b = createHash("sha256").update(`${group}:${recipient}`).digest()[0]!;
  return (b & 1) as 0 | 1;
}

export function splitForAb<T>(
  items: readonly T[],
  key: (t: T) => number | string,
  mark: AbMark,
): T[] {
  return items.filter((x) => abHalf(key(x), mark.group) === mark.half);
}

export type AbSide = { id: string; sent: number; clicks: number };

/** Итог теста: доля нажатий у каждого варианта и кто впереди (null — поровну или мало данных). */
export function abResult(
  a: AbSide,
  b: AbSide,
): { rateA: number; rateB: number; leader: "A" | "B" | null } {
  const rate = (s: AbSide) => (s.sent > 0 ? Math.round((s.clicks / s.sent) * 1000) / 10 : 0);
  const rateA = rate(a);
  const rateB = rate(b);
  const leader = a.sent + b.sent < 20 || rateA === rateB ? null : rateA > rateB ? "A" : "B";
  return { rateA, rateB, leader };
}
