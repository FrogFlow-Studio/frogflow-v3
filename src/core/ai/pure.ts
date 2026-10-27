/**
 * ИИ-баланс клиента в долларах — чистые правила (решение владельца 27.09):
 * токены ИИ оплачивает клиент, при подключении у него стартовые 5 $, дальше
 * депозит. Хранение и запись — core/ai/balance.ts.
 */
export const AI_START_USD = 5;
/** Ниже этого — «баланс почти кончился», продавцу предупреждение один раз. */
export const AI_LOW_USD = 1;
/** Наценка оператора на цену API, %: по умолчанию 0, выше — защита от опечатки. */
export const AI_MARKUP_MAX = 500;
/** Пополнение продавцом, $: не меньше стартовой суммы, выше — защита от опечатки. */
export const AI_TOPUP_MIN_USD = 5;
export const AI_TOPUP_MAX_USD = 500;

export type AiUse =
  | "consultant"
  | "assistant"
  | "smart_search"
  | "receipt_ocr"
  | "tutor"
  | "cache_warm";

export const AI_USE_LABEL: Record<AiUse, string> = {
  consultant: "ИИ-консультант",
  assistant: "ИИ-помощник (тексты товаров)",
  smart_search: "Умный поиск",
  receipt_ocr: "Распознавание чеков",
  tutor: "ИИ-наставник уроков",
  cache_warm: "Прогрев кеша консультанта",
};

/**
 * Состояние баланса: сумма и какие предупреждения уже ушли с последнего
 * пополнения. `topups` — id последних зачисленных счетов (до AI_TOPUP_SEEN):
 * повтор зачисления того же счёта (потерян ответ базы, повторное
 * подтверждение) ничего не меняет — проверка той же атомарной записью.
 */
export type AiBalanceState = { usd: number; low: boolean; empty: boolean; topups?: string[] };
export const AI_TOPUP_SEEN = 20;

export const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function parseBalance(raw: string | null | undefined): AiBalanceState | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as Partial<AiBalanceState>;
    const usd = Number(v.usd);
    if (!Number.isFinite(usd)) return null;
    const topups = Array.isArray(v.topups)
      ? v.topups.filter((x): x is string => typeof x === "string").slice(-AI_TOPUP_SEEN)
      : [];
    return {
      usd: round6(usd),
      low: v.low === true,
      empty: v.empty === true,
      ...(topups.length ? { topups } : {}),
    };
  } catch {
    return null;
  }
}

export const formatBalance = (b: AiBalanceState) => JSON.stringify(b);

/** Цена для клиента: цена API плюс наценка оператора. */
export function withMarkup(apiUsd: number, markupPercent: number): number {
  const m = Number.isFinite(markupPercent)
    ? Math.min(Math.max(markupPercent, 0), AI_MARKUP_MAX)
    : 0;
  return round6(Math.max(0, apiUsd) * (1 + m / 100));
}

/**
 * Изменить баланс на `delta` и решить, какие предупреждения отправить. Флаг
 * ставится той же записью, что меняет сумму, поэтому предупреждение уходит
 * один раз; снимается, когда баланс снова не ниже порога (пополнение).
 */
export function applyDelta(
  b: AiBalanceState,
  delta: number,
): { next: AiBalanceState; warn: "low" | "empty" | null } {
  const usd = round6(b.usd + delta);
  const refilled = usd >= AI_LOW_USD;
  const next: AiBalanceState = {
    ...b,
    usd,
    low: refilled ? false : b.low,
    empty: refilled ? false : b.empty,
  };
  if (usd <= 0 && !next.empty)
    return { next: { ...next, usd, low: true, empty: true }, warn: "empty" };
  if (!refilled && !next.low) return { next: { ...next, low: true }, warn: "low" };
  return { next, warn: null };
}

/** Денег меньше, чем бронь вызова: ИИ стоит, продавцу «кончился» — один раз. */
export function markShort(b: AiBalanceState): { next: AiBalanceState; warn: "empty" } | null {
  return b.empty ? null : { next: { ...b, low: true, empty: true }, warn: "empty" };
}

/** Расход за день по видам ИИ: одна строка журнала на день, а не на каждый ответ. */
export type DailyCharges = {
  date: string;
  uses: Partial<Record<AiUse, { usd: number; calls: number }>>;
};

export function parseCharges(raw: string | null | undefined, date: string): DailyCharges {
  try {
    const v = JSON.parse(raw ?? "null") as DailyCharges | null;
    if (v && v.date === date && v.uses && typeof v.uses === "object") return v;
  } catch {
    /* пустой день */
  }
  return { date, uses: {} };
}

export function addCharge(d: DailyCharges, use: AiUse, usd: number): DailyCharges {
  const cur = d.uses[use] ?? { usd: 0, calls: 0 };
  return {
    ...d,
    uses: { ...d.uses, [use]: { usd: round6(cur.usd + Math.max(0, usd)), calls: cur.calls + 1 } },
  };
}

/** Цена ответа Anthropic по usage и цене модели за миллион токенов. */
export type TokenPrice = { in: number; out: number; cacheWrite?: number; cacheRead?: number };

/** Haiku 4.5 — модель консультанта, помощника и умного поиска. */
export const HAIKU_PRICE: TokenPrice = { in: 1, out: 5, cacheWrite: 2, cacheRead: 0.1 };

/**
 * Sonnet 5 и Haiku 5.5 по умолчанию рассуждают — для чата это задержка, а не
 * качество. У Haiku 5.5 выключение допустимо при effort до high (по
 * умолчанию medium).
 */
export function modelParams(model: string): Record<string, unknown> {
  if (/^claude-(sonnet-5|haiku-5)/.test(model)) return { thinking: { type: "disabled" } };
  return {};
}
