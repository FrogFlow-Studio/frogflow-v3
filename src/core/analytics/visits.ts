import {
  SOURCE_DIRECT,
  SOURCE_OTHER,
  SOURCE_ROWS,
  sourceGroup,
  type SourceRow,
} from "./source-funnel";

/**
 * Визиты витрины по источникам (У1): чистая часть. Счётчик без личных данных —
 * в базу уходит только группа источника, день и этап (migrations/22-3).
 *
 * Источник визита: метка из ссылки (utm_source, ref) → та же группа, что у
 * воронки по источникам (sourceGroup); без метки — по тому, откуда пришли:
 * поисковик → `search`, площадка FrogFlow (/market) → `market`, другой сайт →
 * `link`; иначе `direct`. Адрес реферера читается здесь и нигде не хранится.
 *
 * Модуль без базы: его читают сервер и тесты.
 */
export const VISIT_STAGES = ["visit", "product"] as const;
export type VisitStage = (typeof VISIT_STAGES)[number];

export const SOURCE_SEARCH = "search";
export const SOURCE_MARKET = "market";
export const SOURCE_LINK = "link";

/** Разных источников в день на магазин: остальное складывается в «other», счётчик не раздуть мусорными метками. */
export const VISIT_SOURCES_PER_DAY = 40;

const SEARCH_HOST =
  /(^|\.)(google|yandex|bing|duckduckgo|yahoo|baidu|ecosia|ya)\.[a-z]{2,}(\.[a-z]{2})?$|(^|\.)search\.[a-z0-9-]+\.[a-z]{2,}$/i;

/** Группа источника визита; referrer — полный адрес из браузера (или null), ownHost — хост платформы. */
export function visitSource(input: {
  webSource: string | null;
  referrer: string | null;
  ownHost?: string | null;
}): string {
  if (input.webSource) return sourceGroup(input.webSource);
  const ref = input.referrer?.trim().slice(0, 300);
  if (!ref) return SOURCE_DIRECT;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return SOURCE_DIRECT;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return SOURCE_DIRECT;
  const host = url.hostname.toLowerCase();
  const own = input.ownHost?.toLowerCase() ?? null;
  if (own && host === own)
    return url.pathname.startsWith("/market") ? SOURCE_MARKET : SOURCE_DIRECT;
  if (SEARCH_HOST.test(host)) return SOURCE_SEARCH;
  return SOURCE_LINK;
}

export type VisitRow = { day: string; source: string; stage: string; n: number };
export type VisitTotals = { visit: number; product: number };
export type VisitsReport = {
  total: VisitTotals;
  /** Группа источника → визиты и просмотры товара. */
  bySource: Record<string, VisitTotals>;
};

/** Строки счётчика за период в итоги и по источникам; незнакомый этап и неположительное число пропускаются. */
export function foldVisits(rows: readonly VisitRow[]): VisitsReport {
  const total: VisitTotals = { visit: 0, product: 0 };
  const bySource: Record<string, VisitTotals> = {};
  for (const r of rows) {
    if (r.stage !== "visit" && r.stage !== "product") continue;
    const n = Math.floor(Number(r.n));
    if (!(n > 0)) continue;
    total[r.stage] += n;
    const s = (bySource[r.source] ??= { visit: 0, product: 0 });
    s[r.stage] += n;
  }
  return { total, bySource };
}

export type SourceRowWithVisits = SourceRow & Partial<VisitTotals>;

/**
 * Визиты в строки воронки по источникам: у каждой группы свои, строка «all» —
 * итог. Источник, с которого заходили, но не покупали (самое интересное для
 * кампании без заказов), получает свою строку, пока есть место (SOURCE_ROWS);
 * остальные уходят в «other», чтобы таблица не росла и сумма сходилась с итогом.
 */
export function attachVisits(rows: readonly SourceRow[], v: VisitsReport): SourceRowWithVisits[] {
  const known = new Set(rows.map((r) => r.source));
  const shown = rows.filter((r) => r.source !== "all" && r.source !== SOURCE_OTHER).length;
  const extras = Object.entries(v.bySource)
    .filter(([source]) => !known.has(source))
    .sort(([a, x], [b, y]) => y.visit - x.visit || y.product - x.product || a.localeCompare(b));
  const room = Math.max(0, SOURCE_ROWS - shown);
  const own = extras.slice(0, room);
  const rest: VisitTotals = { visit: 0, product: 0 };
  for (const [, t] of extras.slice(room)) {
    rest.visit += t.visit;
    rest.product += t.product;
  }
  const blank = (source: string): SourceRowWithVisits => ({
    source,
    arrived: 0,
    cart: 0,
    ordered: 0,
    paid: 0,
    revenue: {},
  });
  const mine = (r: SourceRow): SourceRowWithVisits => ({
    ...r,
    ...(v.bySource[r.source] ?? { visit: 0, product: 0 }),
  });
  const all = rows.filter((r) => r.source === "all").map((r) => ({ ...r, ...v.total }));
  const named = rows.filter((r) => r.source !== "all" && r.source !== SOURCE_OTHER).map(mine);
  const added = own.map(([source, t]) => ({ ...blank(source), ...t }));
  const other = rows.find((r) => r.source === SOURCE_OTHER);
  const tail: SourceRowWithVisits[] =
    other || rest.visit || rest.product
      ? [
          {
            ...(other ?? blank(SOURCE_OTHER)),
            visit: (v.bySource[SOURCE_OTHER]?.visit ?? 0) + rest.visit,
            product: (v.bySource[SOURCE_OTHER]?.product ?? 0) + rest.product,
          },
        ]
      : [];
  return rows.length ? [...all, ...named, ...added, ...tail] : [];
}
