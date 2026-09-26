/**
 * Умный поиск по каталогу — чистая часть: разбор ответа модели, счётчики
 * и стоимость. Без сети и базы.
 */

export const SMART_SEARCH_MODEL = "claude-haiku-4-5";
export const DAILY_LIMIT = 200;
/**
 * Дневной предел расходов на бота в долларах. Счётчик запросов один не
 * спасает: запрос по каталогу в 600 товаров стоит ~$0.1, и 200 таких — уже
 * $20 в день на ключе платформы.
 */
export const DAILY_USD_LIMIT = 3;
/** Выше этого оператор поднять не может — защита от опечатки в лишний ноль. */
export const SMART_SEARCH_USD_MAX = 100;

/** Свой предел клиента в bots.settings.smart_search_limits; нет/null — общий. */
export type SmartSearchLimitsSetting = { daily_usd?: number | null };

/** Действующий дневной предел клиента в долларах; 0 — умный поиск выключен. */
export function smartSearchUsdLimit(s: SmartSearchLimitsSetting | null | undefined): number {
  const v = s?.daily_usd;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return DAILY_USD_LIMIT;
  return Math.min(v, SMART_SEARCH_USD_MAX);
}
export const COOLDOWN_SECONDS = 45;
export const MAX_CANDIDATES = 600;
export const MAX_QUERY_LEN = 200;

/** Цены Haiku 4.5 за миллион токенов (обычный ввод/вывод, без кеша). */
export const INPUT_USD_PER_MTOK = 1;
export const OUTPUT_USD_PER_MTOK = 5;

export type TokenUsage = { inputTokens: number; outputTokens: number };

export function estimateUsd(u: TokenUsage): number {
  return (
    (Math.max(0, u.inputTokens) * INPUT_USD_PER_MTOK +
      Math.max(0, u.outputTokens) * OUTPUT_USD_PER_MTOK) /
    1_000_000
  );
}

/**
 * Ответ модели не доверенный: из текста вытаскиваем JSON {"ids": [...]} и
 * оставляем только id из реально переданных кандидатов — «фантазия» модели
 * не покажет покупателю выдуманный товар.
 */
export function parseSmartSearchIds(text: string, validIds: Iterable<string>): string[] {
  const valid = new Set(validIds);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const ids = (parsed as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  return ids.filter((id): id is string => {
    if (typeof id !== "string" || !valid.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** «2026-09-21:17» — дата в самом значении: новый день обнуляет счётчик сам. */
export function parseDailyCount(raw: string | null | undefined, today = todayUtc()): number {
  const [d, n] = (raw ?? "").split(":");
  return d === today ? Number(n) || 0 : 0;
}

export function formatDailyCount(count: number, today = todayUtc()): string {
  return `${today}:${count}`;
}

export type Spend = { count: number; inputTokens: number; outputTokens: number; usd: number };

export function parseSpend(raw: string | null | undefined): Spend {
  const empty: Spend = { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  if (!raw?.trim()) return empty;
  try {
    const p = JSON.parse(raw) as Partial<Spend>;
    return {
      count: Math.max(0, Number(p.count) || 0),
      inputTokens: Math.max(0, Number(p.inputTokens) || 0),
      outputTokens: Math.max(0, Number(p.outputTokens) || 0),
      usd: Math.max(0, Number(p.usd) || 0),
    };
  } catch {
    return empty;
  }
}

/** Расход за сегодня (UTC) из smart_search_daily_spend; другой день или мусор — 0. */
export function dailySpendUsd(raw: string | null | undefined, today = todayUtc()): number {
  try {
    const p = JSON.parse(raw ?? "") as { date?: unknown };
    return p?.date === today ? parseSpend(raw).usd : 0;
  } catch {
    return 0;
  }
}

export function spendExhausted(
  raw: string | null | undefined,
  today = todayUtc(),
  limit = DAILY_USD_LIMIT,
): boolean {
  return dailySpendUsd(raw, today) >= limit;
}

export function addSpend(prev: Spend, u: TokenUsage): Spend {
  return {
    count: prev.count + 1,
    inputTokens: prev.inputTokens + Math.max(0, u.inputTokens),
    outputTokens: prev.outputTokens + Math.max(0, u.outputTokens),
    usd: Math.round((prev.usd + estimateUsd(u)) * 1_000_000) / 1_000_000,
  };
}

/** Домен для промпта: модель должна понимать, что и зачем ищут в этой нише. */
export function domainHint(vertical: string): string {
  switch (vertical) {
    case "confectionery":
      return "Покупатель ищет торт или десерт на заказ в кондитерской.";
    case "flowers":
      return "Покупатель ищет букет или цветочную композицию на заказ.";
    case "consultant":
    case "consultant_universal":
      return "Покупатель подбирает товар из прайса консультанта (размер, цвет, состав, наличие). Не выдумывай цены и остатки — только позиции из списка.";
    default:
      return "Покупатель ищет учебный материал в каталоге материалов для учителей.";
  }
}

export type Candidate = { id: string; name: string; description: string; keywords: string };

export function buildPrompt(vertical: string, query: string, candidates: Candidate[]): string {
  return (
    `${domainHint(vertical)} Запрос: "${query}"\n\n` +
    `Список товаров (JSON):\n${JSON.stringify(candidates)}\n\n` +
    `Выбери id товаров, которые реально подходят под запрос по смыслу — не только по точному ` +
    `совпадению слов. Если ничего не подходит, верни пустой список. Отвечай СТРОГО одним JSON-` +
    `объектом без пояснений, в формате {"ids": ["id1", "id2"]}, id упорядочены по убыванию ` +
    `релевантности.`
  );
}
