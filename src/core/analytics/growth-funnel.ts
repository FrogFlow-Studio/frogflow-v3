import { stageRate, type FunnelRow, type FunnelStage } from "./funnel";

/**
 * Воронка роста (У2). Без счётчика визитов (миграция 22-3 ещё не применена или
 * визитов нет) — прежняя воронка по всем каналам: пришли → корзина → заказ →
 * оплата. С визитами витрины — воронка сайта: визит → товар → корзина → заказ →
 * оплата, где корзина, заказ и оплата берутся только из канала «сайт», чтобы
 * шаги не смешивали бота и витрину. Пустой период — «пока нет данных», а не
 * ряд нулей. Модуль без базы: его читают страница и тесты.
 */
export type SiteVisits = { visit: number; product: number };
export type GrowthStageKey = "visit" | "product" | FunnelStage;
export type GrowthStage = { key: GrowthStageKey; value: number; rate: number | null };
export type GrowthFunnel =
  { empty: true } | { empty: false; mode: "all" | "site"; stages: GrowthStage[] };

export function growthFunnel(rows: readonly FunnelRow[], visits: SiteVisits | null): GrowthFunnel {
  const all = rows.find((r) => r.channel === "all");
  const web = rows.find((r) => r.channel === "web");
  const site = visits !== null && visits.visit > 0;
  const values: Array<[GrowthStageKey, number]> = site
    ? [
        ["visit", visits.visit],
        ["product", visits.product],
        ["cart", web?.cart ?? 0],
        ["ordered", web?.ordered ?? 0],
        ["paid", web?.paid ?? 0],
      ]
    : [
        ["arrived", all?.arrived ?? 0],
        ["cart", all?.cart ?? 0],
        ["ordered", all?.ordered ?? 0],
        ["paid", all?.paid ?? 0],
      ];
  if (values.every(([, v]) => v === 0)) return { empty: true };
  return {
    empty: false,
    mode: site ? "site" : "all",
    stages: values.map(([key, value], i) => ({
      key,
      value,
      rate: i ? stageRate(values[i - 1]![1], value) : null,
    })),
  };
}
