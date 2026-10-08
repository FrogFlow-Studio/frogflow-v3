/**
 * Модель консультанта по прайсу глазами оператора: что записано в настройке
 * consultant_model, на какой модели консультант отвечает на самом деле и во
 * что обошлись ответы за неделю. Опечатка в настройке (не из проверенного
 * списка) молча включает модель платформы — здесь она видна как ошибка.
 */

export type ModelChoice = {
  /** Значение настройки как есть; пусто — не задано. */
  stored: string;
  /** На какой модели консультант отвечает. */
  effective: string;
  /** Записано значение не из списка: консультант отвечает моделью платформы. */
  unknown: boolean;
};

export function modelChoice(
  stored: string | null | undefined,
  allowed: readonly string[],
  fallback: string,
): ModelChoice {
  const v = (stored ?? "").trim();
  const ok = allowed.includes(v);
  return { stored: v, effective: ok ? v : fallback, unknown: v !== "" && !ok };
}

export type ModelWeekRow = { model: string | null; token_usage: unknown };
export type ModelWeek = { model: string; runs: number; usd: number; avgUsd: number };

/** Расход по моделям из журнала ответов: ходов с вызовом модели, сумма и цена хода. */
export function modelWeek(rows: readonly ModelWeekRow[]): ModelWeek[] {
  const by = new Map<string, { runs: number; usd: number }>();
  for (const r of rows) {
    if (!r.model) continue;
    const u = r.token_usage as { usd?: unknown } | null;
    const usd = typeof u?.usd === "number" && Number.isFinite(u.usd) ? u.usd : 0;
    const g = by.get(r.model) ?? { runs: 0, usd: 0 };
    g.runs += 1;
    g.usd += usd;
    by.set(r.model, g);
  }
  return [...by]
    .map(([model, g]) => ({
      model,
      runs: g.runs,
      usd: Math.round(g.usd * 10_000) / 10_000,
      avgUsd: Math.round((g.usd / g.runs) * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
}
