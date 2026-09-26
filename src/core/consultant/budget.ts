/**
 * Дневной предел ИИ-консультанта на клиента. Консультант работает на ключе
 * Anthropic платформы, поэтому до вызова модели проверяем, сколько клиент
 * уже потратил сегодня (UTC), а тест-чат админки считаем отдельно: им можно
 * гонять модель со своими инструкциями без покупателей.
 *
 * Предел по умолчанию общий (CONSULTANT_LIMITS); клиенту с большим потоком
 * оператор поднимает свой в `bots.settings.consultant_limits` (limitsFor).
 *
 * Счётчик лежит в bot_settings (consultant_daily) — схема не меняется.
 * Чтение и запись не атомарны: при параллельных сообщениях предел может быть
 * превышен на несколько ответов, это мягкий потолок, а не бухгалтерия.
 */
export const CONSULTANT_LIMITS: ConsultantLimits = {
  /** ≈ 2 500 ₸ в день — сотни ответов Haiku; выше — вопрос тарифа. */
  dailyUsd: 5,
  /** Ответов покупателям в день, даже если они дешёвые. */
  dailyCalls: 1000,
  /** Пробных вопросов из админки в день. */
  dailyTests: 30,
};

export type ConsultantLimits = { dailyUsd: number; dailyCalls: number; dailyTests: number };

/** Выше этого оператор поднять не может — защита от опечатки в лишний ноль. */
export const CONSULTANT_LIMIT_MAX: ConsultantLimits = {
  dailyUsd: 500,
  dailyCalls: 100_000,
  dailyTests: 1000,
};

/** Свой предел клиента, как он лежит в bots.settings; null/нет — общий. */
export type ConsultantLimitsSetting = {
  daily_usd?: number | null;
  daily_calls?: number | null;
  daily_tests?: number | null;
};

/** Действующий предел клиента: своё значение, если оно осмысленно, иначе общее. */
export function limitsFor(s: ConsultantLimitsSetting | null | undefined): ConsultantLimits {
  const pick = (v: unknown, def: number, max: number, int: boolean) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return def;
    return Math.min(int ? Math.floor(v) : v, max);
  };
  return {
    dailyUsd: pick(s?.daily_usd, CONSULTANT_LIMITS.dailyUsd, CONSULTANT_LIMIT_MAX.dailyUsd, false),
    dailyCalls: pick(
      s?.daily_calls,
      CONSULTANT_LIMITS.dailyCalls,
      CONSULTANT_LIMIT_MAX.dailyCalls,
      true,
    ),
    dailyTests: pick(
      s?.daily_tests,
      CONSULTANT_LIMITS.dailyTests,
      CONSULTANT_LIMIT_MAX.dailyTests,
      true,
    ),
  };
}

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
export function budgetBlock(
  b: DailyBudget,
  kind: "customer" | "test",
  limits: ConsultantLimits = CONSULTANT_LIMITS,
): string | null {
  if (b.usd >= limits.dailyUsd)
    return `Дневной предел расходов ИИ-консультанта ($${limits.dailyUsd}) исчерпан — до полуночи UTC вопросы уходят менеджеру.`;
  if (kind === "customer" && b.calls >= limits.dailyCalls)
    return `Дневной предел ответов ИИ-консультанта (${limits.dailyCalls}) исчерпан — до полуночи UTC вопросы уходят менеджеру.`;
  if (kind === "test" && b.tests >= limits.dailyTests)
    return `Пробных вопросов на сегодня больше нет (${limits.dailyTests} в день). Попробуйте завтра.`;
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

/**
 * Месячный счёт ИИ-диалогов для лимита плана (core/plans). Диалог — разговор
 * одного покупателя с консультантом: новый начинается, если консультант ещё
 * не отвечал этому покупателю или молчал дольше суток. Продолжение уже
 * начатого диалога лимит не останавливает — покупателя не бросают на
 * полуслове.
 */
export const DIALOG_GAP_MS = 24 * 3600_000;

export function startsNewDialog(lastReplyAt: string | undefined, now = Date.now()): boolean {
  if (!lastReplyAt) return true;
  const t = new Date(lastReplyAt).getTime();
  return !Number.isFinite(t) || now - t > DIALOG_GAP_MS;
}

export type MonthlyDialogs = { month: string; count: number };

export function parseMonthly(raw: string | null | undefined, month: string): MonthlyDialogs {
  try {
    const v = JSON.parse(raw || "{}") as Partial<MonthlyDialogs>;
    const n = Number(v.count);
    return { month, count: v.month === month && Number.isFinite(n) && n > 0 ? n : 0 };
  } catch {
    return { month, count: 0 };
  }
}
