/**
 * Прайс консультанта из Google Таблицы (перенос importCatalogFromSheetsUrl и
 * refreshCatalogFromSavedSheet v1). Ссылка — та же строка app_settings
 * `consultant_sheets_url`, что у v1; формат колонок — как у выгрузки 1С
 * (parseCatalogCsv). Скачивание и проверка ссылки — общие с каталогом
 * магазина (core/catalog/sheet: только docs.google.com, закрытая таблица ≠ CSV).
 *
 * Правило: неудачное обновление прайс не трогает. Не скачалось, закрыто,
 * пусто, ни одной позиции — остаётся прежний прайс, а продавец видит время
 * последнего удачного обновления и причину.
 * Модуль без базы: его читают и сервер, и тесты.
 */
import type { SheetFailure } from "@/core/catalog/sheet";
import type { ConsultantProduct } from "./catalog";

export const SHEETS_URL_KEY = "consultant_sheets_url";
export const SHEETS_STATUS_KEY = "consultant_sheets_status";

/**
 * Автообновление не применяет таблицу, в которой позиций вдвое меньше, чем в
 * прайсе (от этого числа позиций): вероятнее, что лист обрезали или отфильтровали,
 * чем что магазин распродал половину. Продавец увидит причину и загрузит
 * таблицу вручную — после предпросмотра с разницей.
 */
export const SHRINK_GUARD_MIN = 20;

export type PricelistSheetFailure =
  | SheetFailure
  /** В таблице нет ни одной позиции с ценой. */
  | "noRows"
  /** Позиций стало вдвое меньше — автообновление не применило таблицу. */
  | "shrunk"
  /** Таблица изменилась между предпросмотром и загрузкой. */
  | "changed"
  /**
   * Цены изменились подозрительно сильно (больше половины позиций или
   * многие в разы) — похоже на сдвиг столбца: автообновление не применило.
   */
  | "pricesJumped";

export type PricelistDiff = {
  added: number;
  removed: number;
  priceChanged: number;
  unchanged: number;
  /** Несколько примеров для предпросмотра. */
  samples: {
    added: string[];
    removed: string[];
    priceChanged: Array<{ name: string; from: number; to: number }>;
  };
};

export type SheetStatus = {
  /** Время последней попытки. */
  at: string;
  ok: boolean;
  reason?: PricelistSheetFailure;
  /** Последнее удачное обновление (сохраняется и после неудачных). */
  lastOkAt?: string;
  /** Позиций в последней удачно прочитанной таблице. */
  count?: number;
  /** Неудачных попыток подряд (сбрасывается удачной). */
  fails?: number;
};

/** После стольких неудач подряд продавцу уходит одно сообщение в Telegram. */
export const SHEET_FAIL_NOTICE_AT = 3;

const SAMPLES = 5;

/** Ключ позиции для сравнения: id из 1С нестабилен (номер строки), название с размером — стабильны. */
function productKey(p: ConsultantProduct): string {
  return `${p.name}|${p.size}`.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Ключи с номером повтора: две одинаковые строки прайса — две позиции. */
function keyed(products: ConsultantProduct[]): Map<string, ConsultantProduct> {
  const seen = new Map<string, number>();
  const out = new Map<string, ConsultantProduct>();
  for (const p of products) {
    const k = productKey(p);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    out.set(`${k}#${n}`, p);
  }
  return out;
}

/** Что изменится, если заменить прайс `before` на `after`. */
export function diffPricelists(
  before: ConsultantProduct[],
  after: ConsultantProduct[],
): PricelistDiff {
  const a = keyed(before);
  const b = keyed(after);
  const diff: PricelistDiff = {
    added: 0,
    removed: 0,
    priceChanged: 0,
    unchanged: 0,
    samples: { added: [], removed: [], priceChanged: [] },
  };
  for (const [k, p] of b) {
    const old = a.get(k);
    if (!old) {
      diff.added++;
      if (diff.samples.added.length < SAMPLES) diff.samples.added.push(p.name);
    } else if (old.price_kzt !== p.price_kzt) {
      diff.priceChanged++;
      if (diff.samples.priceChanged.length < SAMPLES)
        diff.samples.priceChanged.push({ name: p.name, from: old.price_kzt, to: p.price_kzt });
    } else diff.unchanged++;
  }
  for (const [k, p] of a)
    if (!b.has(k)) {
      diff.removed++;
      if (diff.samples.removed.length < SAMPLES) diff.samples.removed.push(p.name);
    }
  return diff;
}

/** Отпечаток прайса (FNV-1a по JSON): предпросмотр и загрузка видят одну и ту же таблицу. */
export function pricelistFingerprint(products: ConsultantProduct[]): string {
  const s = JSON.stringify(products);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${products.length}`;
}

/**
 * Цены прыгнули подозрительно (сдвиг столбца, курс вместо цены): среди
 * совпавших позиций (от SHRINK_GUARD_MIN) изменилась больше половины цен,
 * или у 10% (не меньше трёх) цена выросла или упала втрое и сильнее.
 */
export function pricesJumped(before: ConsultantProduct[], after: ConsultantProduct[]): boolean {
  const a = keyed(before);
  let matched = 0;
  let changed = 0;
  let wild = 0;
  for (const [k, p] of keyed(after)) {
    const old = a.get(k);
    if (!old) continue;
    matched++;
    if (old.price_kzt === p.price_kzt) continue;
    changed++;
    const lo = Math.min(old.price_kzt, p.price_kzt);
    const hi = Math.max(old.price_kzt, p.price_kzt);
    if (lo <= 0 || hi / lo >= 3) wild++;
  }
  if (matched < SHRINK_GUARD_MIN) return false;
  return changed * 2 > matched || wild >= Math.max(3, Math.ceil(matched * 0.1));
}

/** Таблица подозрительно короче прайса — автообновлением не применять. */
export function shrunkTooMuch(before: number, after: number): boolean {
  return before >= SHRINK_GUARD_MIN && after * 2 < before;
}

export function parseSheetStatus(raw: string | null | undefined): SheetStatus | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SheetStatus>;
    if (typeof o.at !== "string" || typeof o.ok !== "boolean") return null;
    return {
      at: o.at,
      ok: o.ok,
      ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
      ...(typeof o.lastOkAt === "string" ? { lastOkAt: o.lastOkAt } : {}),
      ...(typeof o.count === "number" ? { count: o.count } : {}),
      ...(typeof o.fails === "number" ? { fails: o.fails } : {}),
    };
  } catch {
    return null;
  }
}

/** Следующий статус: удачная попытка двигает lastOkAt, неудачная его сохраняет. */
export function nextSheetStatus(
  prev: SheetStatus | null,
  run: { ok: true; count: number } | { ok: false; reason: PricelistSheetFailure },
  now: Date,
): SheetStatus {
  const at = now.toISOString();
  if (run.ok) return { at, ok: true, lastOkAt: at, count: run.count };
  return {
    at,
    ok: false,
    reason: run.reason,
    ...(prev?.lastOkAt ? { lastOkAt: prev.lastOkAt } : {}),
    ...(prev?.count !== undefined ? { count: prev.count } : {}),
    fails: (prev && !prev.ok ? (prev.fails ?? 1) : 0) + 1,
  };
}
