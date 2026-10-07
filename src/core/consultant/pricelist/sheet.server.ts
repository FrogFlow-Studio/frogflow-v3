/**
 * Прайс консультанта из Google Таблицы: предпросмотр с разницей, загрузка по
 * ссылке и автообновление кроном (core/consultant/pricelist/sheet — правила).
 * Неудача никогда не стирает прайс: сохраняется он только после того, как
 * таблица скачалась и в ней нашлись позиции.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { downloadSheet, type FetchLike } from "@/core/catalog/sheet.server";
import { getSettingsStrict, setSetting, updateSettingAtomic } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import type { ConsultantProduct } from "./catalog";
import {
  CATALOG_KEY,
  isConsultantProduct,
  savePricelist,
  type CatalogMeta,
} from "./catalog.server";
import { parseCatalogCsv, type CatalogImportError } from "./import";
import {
  diffPricelists,
  nextSheetStatus,
  parseSheetStatus,
  pricelistFingerprint,
  shrunkTooMuch,
  SHEETS_STATUS_KEY,
  SHEETS_URL_KEY,
  type PricelistDiff,
  type PricelistSheetFailure,
  type SheetStatus,
} from "./sheet";

/** Подпись источника в сводке прайса. */
export const SHEET_SOURCE = "Google Sheets";

type SheetRead =
  | { ok: true; products: ConsultantProduct[]; errors: CatalogImportError[] }
  | { ok: false; reason: PricelistSheetFailure };

/** Скачать таблицу и разобрать её как выгрузку 1С. */
export async function readSheetPricelist(link: string, fetchImpl?: FetchLike): Promise<SheetRead> {
  const dl = await downloadSheet(link, fetchImpl);
  if (!dl.ok) return dl;
  const parsed = parseCatalogCsv(dl.csv);
  if (parsed.products.length === 0) return { ok: false, reason: "noRows" };
  return { ok: true, products: parsed.products, errors: parsed.errors };
}

/** Прайс как он лежит в базе (вместе со снятым). Сбой чтения — ошибка, а не «пусто». */
export async function storedRows(ctx: TenantContext): Promise<ConsultantProduct[]> {
  const s = await getSettingsStrict(ctx, [CATALOG_KEY]);
  try {
    const parsed = JSON.parse(s[CATALOG_KEY]?.trim() || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isConsultantProduct) : [];
  } catch {
    return [];
  }
}

export type SheetLink = { url: string; status: SheetStatus | null };

/** Подключённая таблица и итог последней попытки. */
export async function loadSheetLink(ctx: TenantContext): Promise<SheetLink | null> {
  const s = await getSettingsStrict(ctx, [SHEETS_URL_KEY, SHEETS_STATUS_KEY]);
  const url = s[SHEETS_URL_KEY]?.trim();
  if (!url) return null;
  return { url, status: parseSheetStatus(s[SHEETS_STATUS_KEY]) };
}

export type SheetPreview =
  | { ok: false; reason: PricelistSheetFailure }
  | {
      ok: true;
      count: number;
      current: number;
      diff: PricelistDiff;
      errors: CatalogImportError[];
      errorCount: number;
      fingerprint: string;
    };

/** Предпросмотр: что изменится в прайсе, если загрузить таблицу. Ничего не пишет. */
export async function previewPricelistSheet(
  ctx: TenantContext,
  link: string,
  fetchImpl?: FetchLike,
): Promise<SheetPreview> {
  const r = await readSheetPricelist(link, fetchImpl);
  if (!r.ok) return r;
  const current = await storedRows(ctx);
  return {
    ok: true,
    count: r.products.length,
    current: current.length,
    diff: diffPricelists(current, r.products),
    errors: r.errors.slice(0, 20),
    errorCount: r.errors.length,
    fingerprint: pricelistFingerprint(r.products),
  };
}

async function writeStatus(
  ctx: TenantContext,
  run: Parameters<typeof nextSheetStatus>[1],
  now: Date,
): Promise<void> {
  // Условная запись по маленькому значению статуса: крон и ручная загрузка
  // одновременно не затрут друг другу lastOkAt.
  await updateSettingAtomic(ctx, SHEETS_STATUS_KEY, (raw) =>
    JSON.stringify(nextSheetStatus(parseSheetStatus(raw), run, now)),
  );
}

/**
 * Загрузить таблицу после предпросмотра и подключить её к автообновлению.
 * Отпечаток не совпал — таблица изменилась с предпросмотра: ничего не пишем,
 * продавец смотрит разницу заново.
 */
export async function importPricelistSheet(
  ctx: TenantContext,
  link: string,
  fingerprint: string,
  fetchImpl?: FetchLike,
  now = new Date(),
): Promise<
  | { ok: false; reason: PricelistSheetFailure }
  | { ok: true; meta: CatalogMeta; diff: PricelistDiff; errorCount: number }
> {
  const r = await readSheetPricelist(link, fetchImpl);
  if (!r.ok) return r;
  if (pricelistFingerprint(r.products) !== fingerprint) return { ok: false, reason: "changed" };
  const current = await storedRows(ctx);
  const diff = diffPricelists(current, r.products);
  const meta = await savePricelist(ctx, r.products, SHEET_SOURCE, now);
  await setSetting(ctx, SHEETS_URL_KEY, link.trim());
  await writeStatus(ctx, { ok: true, count: r.products.length }, now);
  return { ok: true, meta, diff, errorCount: r.errors.length };
}

/** Отключить таблицу: прайс остаётся как есть, автообновление прекращается. */
export async function disconnectPricelistSheet(ctx: TenantContext): Promise<void> {
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .in("key", [SHEETS_URL_KEY, SHEETS_STATUS_KEY]);
  if (error) throw serverFailure(`Таблица прайса не отключилась: ${error.message}`);
}

export type SheetRefresh =
  | { skipped: "none" }
  | { ok: true; count: number; changed: boolean }
  | { ok: false; reason: PricelistSheetFailure };

/**
 * Автообновление (крон консультанта, как в v1 — раз в 15 минут): скачать
 * подключённую таблицу и, если позиции изменились, заменить прайс. Неудача —
 * только запись в статус, прайс не трогаем; таблица вдвое короче прайса —
 * тоже не применяем (shrunkTooMuch).
 */
export async function refreshPricelistSheet(
  ctx: TenantContext,
  now = new Date(),
  fetchImpl?: FetchLike,
): Promise<SheetRefresh> {
  const link = await loadSheetLink(ctx);
  if (!link) return { skipped: "none" };
  const r = await readSheetPricelist(link.url, fetchImpl);
  if (!r.ok) {
    await writeStatus(ctx, r, now);
    return r;
  }
  const current = await storedRows(ctx);
  if (shrunkTooMuch(current.length, r.products.length)) {
    await writeStatus(ctx, { ok: false, reason: "shrunk" }, now);
    return { ok: false, reason: "shrunk" };
  }
  const changed = pricelistFingerprint(current) !== pricelistFingerprint(r.products);
  if (changed) await savePricelist(ctx, r.products, SHEET_SOURCE, now);
  await writeStatus(ctx, { ok: true, count: r.products.length }, now);
  return { ok: true, count: r.products.length, changed };
}
