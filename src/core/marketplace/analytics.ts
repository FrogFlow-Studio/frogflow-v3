import { createHash } from "node:crypto";

/**
 * Аналитика площадки FrogFlow (В20), чистая часть. Без личных данных: ни cookie, ни адреса, ни
 * устройства не хранятся. Чтобы один человек за час считался один раз, берём хеш (секрет, час,
 * адрес, браузер): он меняется каждый час, связать посещения разных часов по нему нельзя.
 */
export const MARKET_EVENT_KINDS = ["visit", "search", "empty", "click"] as const;
export type MarketEventKind = (typeof MARKET_EVENT_KINDS)[number];

export const MARKET_STATS = {
  /** За сколько дней показываем и храним события. */
  days: 30,
  keepDays: 40,
  queryMax: 80,
  top: 20,
  /** Сколько разных записей одно устройство даёт за час. */
  deviceCap: 30,
} as const;

const HOUR = 3_600_000;

export const hourBucket = (now: number): string =>
  new Date(Math.floor(now / HOUR) * HOUR).toISOString();

export function dedupeKey(secret: string, bucket: string, ip: string, ua: string): string {
  return createHash("sha256").update(`${secret}|${bucket}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

/** Поисковая фраза без лишнего: нижний регистр, пробелы схлопнуты; пусто — не считаем. */
export function cleanQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().toLowerCase().slice(0, MARKET_STATS.queryMax);
}

export type MarketEventRow = { kind: string; key: string };

export type MarketStats = {
  days: number;
  visits: number;
  searches: number;
  clicks: number;
  topSearches: { query: string; count: number }[];
  /** Искали и не нашли: что людям нужно, а на площадке нет. */
  emptySearches: { query: string; count: number }[];
  /** Переходы в магазины: bot_id → число. */
  clicksByShop: Map<string, number>;
};

const topOf = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([query, count]) => ({ query, count }));

export function summarize(rows: MarketEventRow[]): MarketStats {
  let visits = 0;
  let searches = 0;
  let clicks = 0;
  const q = new Map<string, number>();
  const empty = new Map<string, number>();
  const byShop = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "visit") visits++;
    else if (r.kind === "search") {
      searches++;
      q.set(r.key, (q.get(r.key) ?? 0) + 1);
    } else if (r.kind === "empty") empty.set(r.key, (empty.get(r.key) ?? 0) + 1);
    else if (r.kind === "click") {
      clicks++;
      byShop.set(r.key, (byShop.get(r.key) ?? 0) + 1);
    }
  }
  return {
    days: MARKET_STATS.days,
    visits,
    searches,
    clicks,
    topSearches: topOf(q, MARKET_STATS.top),
    emptySearches: topOf(empty, MARKET_STATS.top),
    clicksByShop: byShop,
  };
}
