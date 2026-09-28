/**
 * Наценка оператора на цену API для ИИ-баланса, % — одна на платформу
 * (operator_settings.ai_markup_percent, по умолчанию 0). Отдельный модуль
 * без тяжёлых импортов: юнит-тесты подменяют источник (tests/setup-env.ts).
 */
export const AI_MARKUP_KEY = "ai_markup_percent";

let markupCache: { at: number; value: number } | null = null;

async function readMarkup(): Promise<number> {
  const { serviceDb } = await import("@/core/db/client.server");
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", AI_MARKUP_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

let markupSource: () => Promise<number> = readMarkup;

/** Для тестов: откуда брать наценку; null — снова из operator_settings. */
export function setAiMarkupSource(fn: (() => Promise<number>) | null) {
  markupSource = fn ?? readMarkup;
  markupCache = null;
}

/**
 * Наценка, %; кэш на минуту. Не прочиталась — 0 (клиент платит цену API),
 * в лог, и без кэша: следующий вызов прочитает снова.
 */
export async function aiMarkupPercent(now = Date.now()): Promise<number> {
  if (markupCache && now - markupCache.at < 60_000) return markupCache.value;
  try {
    const value = await markupSource();
    markupCache = { at: now, value };
    return value;
  } catch (e) {
    console.error(`[ai-balance] наценка не прочитана, считаю 0 %: ${String(e)}`);
    return 0;
  }
}

/** Сбросить кэш: оператор только что поменял наценку. */
export function resetAiMarkupCache() {
  markupCache = null;
}
