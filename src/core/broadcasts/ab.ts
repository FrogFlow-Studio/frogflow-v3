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

/** Сколько заказов должно быть у каждого варианта, чтобы судить по выручке. */
export const AB_MIN_ORDERS = 5;

export type AbMoneySide = AbSide & {
  orders: number;
  paid: number;
  revenue: Record<string, number>;
};

export type AbVerdict = {
  /** По чему выбран победитель: выручка на отправленное сообщение или нажатия. */
  basis: "revenue" | "clicks";
  leader: "A" | "B" | null;
  /** Заказов меньше порога у любого варианта — вывод по нажатиям, с пометкой. */
  lowOrders: boolean;
  /** Заказов хватает, но выручка в разных валютах — по деньгам не сравнить, судим по нажатиям. */
  mixedCurrency: boolean;
};

/**
 * Победитель A/B по деньгам. Если у обоих вариантов не меньше AB_MIN_ORDERS
 * заказов и выручка в одной валюте — сравнивается выручка на отправленное
 * сообщение (половины могут быть не равны). Иначе — нажатия (abResult) и
 * пометка «мало заказов для вывода».
 */
export function abVerdict(a: AbMoneySide, b: AbMoneySide): AbVerdict {
  const enough = a.orders >= AB_MIN_ORDERS && b.orders >= AB_MIN_ORDERS;
  const cur = new Set([...Object.keys(a.revenue), ...Object.keys(b.revenue)]);
  if (enough && cur.size === 1 && a.sent > 0 && b.sent > 0) {
    const c = [...cur][0]!;
    const perA = (a.revenue[c] ?? 0) / a.sent;
    const perB = (b.revenue[c] ?? 0) / b.sent;
    const leader = perA === perB ? null : perA > perB ? "A" : "B";
    return { basis: "revenue", leader, lowOrders: false, mixedCurrency: false };
  }
  return {
    basis: "clicks",
    leader: abResult(a, b).leader,
    lowOrders: !enough,
    mixedCurrency: enough && cur.size > 1,
  };
}
