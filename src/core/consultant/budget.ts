/**
 * Дневной предел ИИ-консультанта на клиента. Консультант работает на ключе
 * Anthropic платформы, поэтому до вызова модели проверяем, сколько клиент
 * уже потратил сегодня (UTC), а тест-чат админки считаем отдельно: им можно
 * гонять модель со своими инструкциями без покупателей.
 *
 * Счётчик лежит в bot_settings (consultant_daily) — схема не меняется.
 * Чтение и запись не атомарны: при параллельных сообщениях предел может быть
 * превышен на несколько ответов, это мягкий потолок, а не бухгалтерия.
 */
export const CONSULTANT_LIMITS = {
  /** ≈ 2 500 ₸ в день — сотни ответов Haiku; выше — вопрос тарифа. */
  dailyUsd: 5,
  /** Ответов покупателям в день, даже если они дешёвые. */
  dailyCalls: 1000,
  /** Пробных вопросов из админки в день. */
  dailyTests: 30,
} as const;

export type DailyBudget = { date: string; usd: number; calls: number; tests: number };

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export function parseDaily(raw: string | null | undefined, date: string): DailyBudget {
  const empty = { date, usd: 0, calls: 0, tests: 0 };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<DailyBudget>;
    if (v.date !== date) return empty;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
    return { date, usd: n(v.usd), calls: n(v.calls), tests: n(v.tests) };
  } catch {
    return empty;
  }
}

/** Текст причины, если вызов сегодня уже нельзя, иначе null. */
export function budgetBlock(b: DailyBudget, kind: "customer" | "test"): string | null {
  if (b.usd >= CONSULTANT_LIMITS.dailyUsd)
    return `Дневной предел расходов ИИ-консультанта ($${CONSULTANT_LIMITS.dailyUsd}) исчерпан — до полуночи UTC вопросы уходят менеджеру.`;
  if (kind === "customer" && b.calls >= CONSULTANT_LIMITS.dailyCalls)
    return `Дневной предел ответов ИИ-консультанта (${CONSULTANT_LIMITS.dailyCalls}) исчерпан — до полуночи UTC вопросы уходят менеджеру.`;
  if (kind === "test" && b.tests >= CONSULTANT_LIMITS.dailyTests)
    return `Пробных вопросов на сегодня больше нет (${CONSULTANT_LIMITS.dailyTests} в день). Попробуйте завтра.`;
  return null;
}

export function addDaily(b: DailyBudget, usd: number, kind: "customer" | "test"): DailyBudget {
  return {
    ...b,
    usd: Math.round((b.usd + Math.max(0, usd)) * 1_000_000) / 1_000_000,
    calls: b.calls + (kind === "customer" ? 1 : 0),
    tests: b.tests + (kind === "test" ? 1 : 0),
  };
}
