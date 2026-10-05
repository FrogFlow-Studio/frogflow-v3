/**
 * Синхронизация каталога с Google Таблицей: скачать CSV-выгрузку и
 * применить её по правилам core/catalog/sheet — не удалять, скрывать только
 * по согласию, не затирать ручные правки. Фото товара в таблице нет, поэтому
 * фотографии синхронизация не трогает вовсе.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import {
  getSetting,
  getSettings,
  trySetSetting,
  updateSettingAtomic,
} from "@/core/settings/settings";
import { createCategory } from "./admin";
import { parseCatalogCsv, planImport } from "./import";
import { recordStockChange } from "./stock-history";
import { patchOf, previewImport, type ImportPreview, type ProductPatch } from "./import.server";
import {
  classifyDownload,
  decideField,
  nameKey,
  parseSheetConfig,
  parseSheetState,
  planHide,
  sheetCsvUrl,
  valueHash,
  SHEET_CONFIG_KEY,
  SHEET_MAX_BYTES,
  SHEET_STATE_KEY,
  SHEET_STATUS_KEY,
  SHEET_TIMEOUT_MS,
  type SheetConfig,
  type SheetDownload,
  type SheetFailure,
  type SheetState,
} from "./sheet";
import { serverFailure } from "@/lib/server-failure";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Куда Google может переадресовать выгрузку открытой таблицы. */
function allowedHop(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "docs.google.com" || url.hostname.endsWith(".googleusercontent.com"))
  );
}

async function readLimited(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/**
 * Скачать CSV листа. Переадресации проходим сами и только по адресам Google;
 * страница входа (accounts.google.com) — таблица закрыта.
 */
export async function downloadSheet(
  link: string,
  fetchImpl: FetchLike = fetch,
): Promise<SheetDownload> {
  const start = sheetCsvUrl(link);
  if (!start) return { ok: false, reason: "badLink" };
  let url = start;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
        headers: { accept: "text/csv,text/plain;q=0.9,*/*;q=0.1" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "download" };
        const next = new URL(loc, url);
        if (next.hostname === "accounts.google.com") return { ok: false, reason: "closed" };
        if (!allowedHop(next)) return { ok: false, reason: "download" };
        url = next.toString();
        continue;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > SHEET_MAX_BYTES) return { ok: false, reason: "tooBig" };
      const body = await readLimited(res, SHEET_MAX_BYTES);
      if (body === null) return { ok: false, reason: "tooBig" };
      return classifyDownload({
        status: res.status,
        contentType: res.headers.get("content-type"),
        finalUrl: url,
        body,
      });
    }
    return { ok: false, reason: "download" };
  } catch {
    return { ok: false, reason: "download" };
  }
}

export type SheetSyncOk = {
  ok: true;
  created: number;
  updated: number;
  /** Скрыто товаров, которых больше нет в таблице (только по настройке). */
  hidden: number;
  /** Вернулись в таблицу и снова показаны. */
  restored: number;
  /** Полей, которые продавец поправил в админке и которые оставлены как есть. */
  kept: number;
  /** Строк, совпавших с товаром, добавленным вручную: ночью такие не трогаем. */
  needsReview: number;
  /** Строк товаров, которые продавец удалил в админке: заново не создаём. */
  skippedDeleted: number;
  /** Пропало подозрительно много товаров — скрывать не стали. */
  guard: boolean;
  errors: string[];
};
export type SheetRun = SheetSyncOk | { ok: false; reason: SheetFailure };
export type SheetStatus = SheetRun & { at: string };

const PRODUCT_COLS =
  "id, name, price, currency, category_ids, description, keywords, is_active, stock_quantity, file_url, file_url_kz, sort_order, fulfillment_kind";

type Row = Record<string, unknown> & { id: string; name: string; is_active: boolean };

/**
 * Применить CSV из таблицы. interactive — продавец сам нажал кнопку после
 * предпросмотра: тогда можно впервые связать товар из админки с таблицей и
 * вернуть удалённый. Ночью (nightly) — только то, чем таблица уже владеет.
 * Ничего не удаляет.
 */
export async function syncFromCsv(
  ctx: TenantContext,
  csv: string,
  cfg: SheetConfig,
  mode: "interactive" | "nightly",
): Promise<SheetRun> {
  const parsed = parseCatalogCsv(csv);
  if (!parsed.fields.includes("name")) return { ok: false, reason: "noHeader" };
  if (parsed.drafts.length === 0) return { ok: false, reason: "empty" };
  const interactive = mode === "interactive";

  const rows = (await pageAll(
    (from, to) => ctx.db.from("products").select(PRODUCT_COLS).order("id").range(from, to),
    "товары для таблицы",
  )) as unknown as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const categories = await pageAll(
    (from, to) => ctx.db.from("categories").select("id, name").order("id").range(from, to),
    "категории для таблицы",
  );
  const catByName = new Map((categories ?? []).map((c) => [nameKey(c.name), c.id]));
  const state = parseSheetState(await getSetting(ctx, SHEET_STATE_KEY));

  const out: SheetSyncOk = {
    ok: true,
    created: 0,
    updated: 0,
    hidden: 0,
    restored: 0,
    kept: 0,
    needsReview: 0,
    skippedDeleted: 0,
    guard: false,
    errors: parsed.errors.map((e) => `строка ${e.line}: ${e.message}`),
  };
  const next: SheetState = {};
  // Товары из таблицы, которые продавец удалил: помним, чтобы ночью не создать заново.
  const goneIds = new Set<string>();
  const goneNames = new Set<string>();
  for (const [id, e] of Object.entries(state))
    if (!byId.has(id)) {
      goneIds.add(id);
      goneNames.add(e.n);
      if (!interactive) next[id] = e;
    }

  let catsCreated = 0;
  const NEW = "new-category:";
  const categoryTarget = (name: string | null): string | null | undefined => {
    if (name === null) return undefined;
    return catByName.get(nameKey(name)) ?? `${NEW}${name.trim()}`;
  };
  const realCategory = async (ids: string[]): Promise<string[]> => {
    const v = ids[0];
    if (!v?.startsWith(NEW)) return ids;
    const name = v.slice(NEW.length);
    let id = catByName.get(nameKey(name));
    if (!id) {
      id = await createCategory(ctx, {
        name,
        parentId: null,
        sortOrder: (categories?.length ?? 0) + catsCreated++,
      });
      catByName.set(nameKey(name), id);
    }
    return [id];
  };

  const plan = planImport(
    parsed.drafts,
    rows.map((r) => ({ id: r.id, name: r.name })),
  );
  const present = new Set<string>();
  for (const { id, by, draft } of plan.update) {
    const cur = byId.get(id)!;
    const entry = state[id];
    if (!entry && !interactive) {
      out.needsReview++;
      continue;
    }
    present.add(id);
    const patch = patchOf(draft, by, categoryTarget(draft.category)) as Record<string, unknown>;
    const restore = Boolean(entry?.hidden) && patch.is_active === undefined;
    if (restore) patch.is_active = true;
    const h = { ...(entry?.h ?? {}) };
    const write: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(patch)) {
      const d = decideField({
        cur: cur[col],
        next: value,
        rec: entry?.h[col],
        overwriteManual: cfg.overwriteManual,
        interactive,
      });
      if (d === "keep") {
        out.kept++;
        continue;
      }
      if (d === "write") write[col] = value;
      else h[col] = valueHash(value);
    }
    try {
      if (Array.isArray(write.category_ids))
        write.category_ids = await realCategory(write.category_ids as string[]);
      if (Object.keys(write).length > 0) {
        const { error } = await ctx.db
          .from("products")
          .update(write as ProductPatch)
          .eq("id", id);
        if (error) throw serverFailure(error.message);
        if ("stock_quantity" in write)
          await recordStockChange(
            ctx,
            {
              productId: id,
              from: (cur.stock_quantity as number | null | undefined) ?? null,
              to: write.stock_quantity as number | null,
            },
            { reason: "sheet", actor: interactive ? "admin" : "system" },
          );
        out.updated++;
        if (restore && write.is_active === true) out.restored++;
      }
      for (const [col, value] of Object.entries(write)) h[col] = valueHash(value);
    } catch (e) {
      out.errors.push(
        `строка ${draft.line} («${draft.name}»): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    next[id] = { n: nameKey(cur.name), h };
  }

  const currency = ((await getSetting(ctx, "currency")) ?? "KZT").toUpperCase();
  for (const d of plan.create) {
    if (!interactive && ((d.id && goneIds.has(d.id)) || goneNames.has(nameKey(d.name)))) {
      out.skippedDeleted++;
      continue;
    }
    try {
      const target = categoryTarget(d.category);
      const categoryIds = target ? await realCategory([target]) : [];
      const row = {
        bot_id: ctx.tenant.id,
        name: d.name,
        description: d.description ?? "",
        keywords: d.keywords ?? "",
        price: d.price ?? 0,
        currency: d.currency ?? currency,
        country_prices: {},
        category_ids: categoryIds,
        is_active: d.active ?? true,
        sort_order: d.sortOrder ?? 0,
        fulfillment_kind: d.kind ?? "digital",
        stock_quantity: d.stock ?? null,
        file_url: d.fileUrl,
        file_url_kz: d.fileUrlKz,
      };
      const { data, error } = await ctx.db.from("products").insert(row).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "insert failed");
      if (d.stock != null)
        await recordStockChange(
          ctx,
          { productId: data.id, from: null, to: d.stock },
          { reason: "sheet", actor: interactive ? "admin" : "system" },
        );
      const h: Record<string, string> = {};
      const cols = Object.keys(patchOf(d, "id", target === undefined ? undefined : categoryIds[0]));
      for (const col of cols) h[col] = valueHash((row as Record<string, unknown>)[col]);
      next[data.id] = { n: nameKey(d.name), h };
      out.created++;
    } catch (e) {
      out.errors.push(
        `строка ${d.line} («${d.name}»): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Товары из таблицы, которых в ней больше нет: запись остаётся, скрываем только по настройке.
  const { hide, guard } = planHide({
    hideMissing: cfg.hideMissing,
    state,
    present,
    existing: byId,
  });
  out.guard = guard;
  const toHide = new Set(hide);
  for (const [id, e] of Object.entries(state)) {
    if (present.has(id) || !byId.has(id)) continue;
    if (!toHide.has(id)) {
      next[id] = e;
      continue;
    }
    const { error } = await ctx.db.from("products").update({ is_active: false }).eq("id", id);
    if (error) {
      out.errors.push(`скрыть «${byId.get(id)!.name}»: ${error.message}`);
      next[id] = e;
      continue;
    }
    out.hidden++;
    next[id] = { ...e, h: { ...e.h, is_active: valueHash(false) }, hidden: true };
  }

  if (!(await trySetSetting(ctx, SHEET_STATE_KEY, JSON.stringify(next))))
    out.errors.push("не сохранилась память о товарах из таблицы");
  out.errors = out.errors.slice(0, 50);
  return out;
}

export async function loadSheet(
  ctx: TenantContext,
): Promise<{ config: SheetConfig | null; status: SheetStatus | null }> {
  const { config, status } = await loadSheetRaw(ctx);
  return { config, status };
}

/** То же, плюс сырая строка статуса: по ней ночной прогон пишет итог условной записью. */
async function loadSheetRaw(ctx: TenantContext): Promise<{
  config: SheetConfig | null;
  status: SheetStatus | null;
  statusRaw: string | null;
}> {
  const s = await getSettings(ctx, [SHEET_CONFIG_KEY, SHEET_STATUS_KEY]);
  const statusRaw = s[SHEET_STATUS_KEY] || null;
  let status: SheetStatus | null = null;
  try {
    status = statusRaw ? (JSON.parse(statusRaw) as SheetStatus) : null;
  } catch {
    status = null;
  }
  return { config: parseSheetConfig(s[SHEET_CONFIG_KEY]), status, statusRaw };
}

export type SheetPreview =
  { ok: false; reason: SheetFailure } | { ok: true; preview: ImportPreview };

export async function previewSheet(
  ctx: TenantContext,
  link: string,
  fetchImpl?: FetchLike,
): Promise<SheetPreview> {
  const dl = await downloadSheet(link, fetchImpl);
  if (!dl.ok) return dl;
  return { ok: true, preview: await previewImport(ctx, dl.csv, Infinity) };
}

/**
 * Скачать и применить таблицу клиента. Не скачалась, закрыта, пуста —
 * каталог не трогаем, итог пишем в статус. notify — что сказать продавцу
 * после ночного прогона (только о новой беде, чтобы не писать каждую ночь).
 */
export async function runSheetSync(
  ctx: TenantContext,
  mode: "interactive" | "nightly",
  fetchImpl?: FetchLike,
): Promise<{ run: SheetRun; notify: string | null } | null> {
  const { config, status: prev, statusRaw } = await loadSheetRaw(ctx);
  if (!config) return null;
  const dl = await downloadSheet(config.url, fetchImpl);
  const run: SheetRun = dl.ok ? await syncFromCsv(ctx, dl.csv, config, mode) : dl;
  const status = JSON.stringify({ ...run, at: new Date().toISOString() } satisfies SheetStatus);
  // Итог — условной записью по прочитанному статусу: из двух кронов, прошедших
  // таблицу одновременно, продавцу пишет тот, чья запись прошла. Сама синхронизация
  // идемпотентна (тот же CSV — тот же каталог), дублировалось бы только сообщение.
  let written: "written" | "skipped" | "failed" = "written";
  if (mode === "nightly")
    written = await updateSettingAtomic(ctx, SHEET_STATUS_KEY, (raw) =>
      (raw || null) === statusRaw ? status : null,
    );
  else await trySetSetting(ctx, SHEET_STATUS_KEY, status);
  let notify: string | null = null;
  if (mode === "nightly" && written !== "skipped") {
    if (!run.ok) {
      const same = prev && !prev.ok && prev.reason === run.reason;
      if (!same) notify = failureText(run.reason);
    } else if (run.guard)
      notify =
        "⚠️ Google Таблица: из неё пропало больше половины товаров. Скрывать их не стал, каталог как был. Проверьте таблицу в разделе «Товары».";
  }
  return { run, notify };
}

export const SHEET_FAILURE_TEXT: Record<SheetFailure, string> = {
  badLink: "ссылка не похожа на Google Таблицу",
  closed: "таблица закрыта: откройте доступ «Все, у кого есть ссылка» (читатель)",
  notFound: "таблица не найдена: возможно, её удалили",
  download: "Google не отдал таблицу, попробую следующей ночью",
  notCsv: "вместо таблицы пришло что-то другое",
  tooBig: "таблица больше 4 МБ",
  empty: "таблица пустая",
  noHeader: "в первой строке нет колонки «Название»",
};

function failureText(reason: SheetFailure): string {
  return `⚠️ Каталог из Google Таблицы не обновлён: ${SHEET_FAILURE_TEXT[reason]}. Товары в магазине не тронуты.`;
}
