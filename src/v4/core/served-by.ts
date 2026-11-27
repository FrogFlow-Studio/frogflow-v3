/**
 * Флаг обслуживания. В этой работе `v4` можно прочитать, записать нельзя:
 * живой магазин остаётся на v2, пока Яков отдельно не скажет «да».
 */

export const WRITABLE_SERVED_BY = ["v1", "v2"] as const;
export type WritableServedBy = (typeof WRITABLE_SERVED_BY)[number];

export function servedByWritable(value: string): value is WritableServedBy {
  return (WRITABLE_SERVED_BY as readonly string[]).includes(value);
}

/** Куда вести вебхук. `other` — v1, пусто и всё, чего нет в списке. */
export function payLane(servedBy: string | undefined): "v2" | "v4" | "other" {
  if (servedBy === "v2") return "v2";
  if (servedBy === "v4") return "v4";
  return "other";
}
