/**
 * Каталог из Google Таблицы по ссылке. Ключ Google не нужен: таблица,
 * открытая «всем, у кого есть ссылка», отдаётся CSV-выгрузкой docs.google.com.
 * Формат колонок — тот же, что у импорта CSV (core/catalog/import).
 *
 * Ночное обновление не должно молча портить каталог, поэтому здесь правила:
 * - таблица закрыта, пуста или не скачалась — каталог не трогаем;
 * - товары, которых нет в таблице, не удаляем никогда, а скрываем, только
 *   если продавец это включил, и только те, что пришли из таблицы;
 * - поле, которое продавец поправил в админке после прошлой синхронизации,
 *   не перезаписываем без его согласия (overwriteManual).
 *
 * Чтобы отличить правку продавца, помним отпечаток значения, которое таблица
 * записала в прошлый раз (app_settings catalog_sheet_state, схема не меняется):
 * текущее значение отличается от отпечатка — его менял продавец.
 * Модуль без базы: его читают и сервер, и тесты.
 */

export const SHEET_CONFIG_KEY = "catalog_sheet";
export const SHEET_STATE_KEY = "catalog_sheet_state";
export const SHEET_STATUS_KEY = "catalog_sheet_status";
/** Как у импорта CSV из админки. */
export const SHEET_MAX_BYTES = 4_000_000;
export const SHEET_TIMEOUT_MS = 20_000;
/** Скрывать больше половины товаров из таблицы за раз подозрительно: вероятно, таблицу обрезали. */
export const HIDE_GUARD_MIN = 3;

export type SheetConfig = {
  /** Ссылка, как её вставил продавец (для показа). */
  url: string;
  /** Скрывать товары из таблицы, которых в ней больше нет. По умолчанию выключено. */
  hideMissing: boolean;
  /** Таблица главнее: перезаписывать поля, поправленные в админке. По умолчанию выключено. */
  overwriteManual: boolean;
};

const ID = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * Ссылка на CSV-выгрузку листа. Принимаем только https://docs.google.com:
 * ссылку «Поделиться» (/spreadsheets/d/<id>/edit#gid=…) и опубликованную
 * (/spreadsheets/d/e/<id>/pub…). Любой другой адрес — null: сервер не должен
 * ходить по ссылкам продавца куда угодно.
 */
export function sheetCsvUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || u.port) return null;
  if (u.username || u.password) return null;
  const gidRaw =
    u.searchParams.get("gid") ?? new URLSearchParams(u.hash.replace(/^#/, "")).get("gid") ?? "";
  const gid = /^\d{1,12}$/.test(gidRaw) ? gidRaw : null;
  const pub = /^\/spreadsheets\/d\/e\/([^/]+)\/pub/.exec(u.pathname);
  if (pub) {
    if (!ID.test(pub[1]!)) return null;
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  }
  const m = /^\/spreadsheets\/d\/([^/]+)/.exec(u.pathname);
  if (!m || m[1] === "e" || !ID.test(m[1]!)) return null;
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

export function parseSheetConfig(raw: string | null | undefined): SheetConfig | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SheetConfig>;
    if (typeof o.url !== "string" || !sheetCsvUrl(o.url)) return null;
    return {
      url: o.url,
      hideMissing: o.hideMissing === true,
      overwriteManual: o.overwriteManual === true,
    };
  } catch {
    return null;
  }
}

export type SheetFailure =
  "badLink" | "closed" | "notFound" | "download" | "notCsv" | "tooBig" | "empty" | "noHeader";

export type SheetDownload = { ok: true; csv: string } | { ok: false; reason: SheetFailure };

/**
 * Что пришло в ответ на выгрузку. Закрытая таблица у Google — переход на
 * страницу входа (accounts.google.com) или HTML вместо CSV; такое никогда
 * не считаем каталогом.
 */
export function classifyDownload(r: {
  status: number;
  contentType: string | null;
  finalUrl: string;
  body: string;
}): SheetDownload {
  let host = "";
  try {
    host = new URL(r.finalUrl).hostname;
  } catch {
    /* пустой адрес — судим по ответу */
  }
  if (host === "accounts.google.com" || r.status === 401 || r.status === 403)
    return { ok: false, reason: "closed" };
  if (r.status === 404) return { ok: false, reason: "notFound" };
  if (r.status < 200 || r.status >= 300) return { ok: false, reason: "download" };
  const type = (r.contentType ?? "").toLowerCase();
  const head = r.body.slice(0, 200).trimStart().toLowerCase();
  if (type.includes("text/html") || head.startsWith("<!doctype") || head.startsWith("<html"))
    return { ok: false, reason: "closed" };
  if (r.body.length > SHEET_MAX_BYTES) return { ok: false, reason: "tooBig" };
  if (!r.body.trim()) return { ok: false, reason: "empty" };
  return { ok: true, csv: r.body };
}

/** Запись о товаре, пришедшем из таблицы: ключ названия и отпечатки записанных полей. */
export type SheetEntry = { n: string; h: Record<string, string>; hidden?: true };
/** По id товара. */
export type SheetState = Record<string, SheetEntry>;

export function parseSheetState(raw: string | null | undefined): SheetState {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: SheetState = {};
    for (const [id, e] of Object.entries(o as Record<string, unknown>)) {
      if (!e || typeof e !== "object") continue;
      const x = e as { n?: unknown; h?: unknown; hidden?: unknown };
      const h: Record<string, string> = {};
      if (x.h && typeof x.h === "object")
        for (const [k, v] of Object.entries(x.h as Record<string, unknown>))
          if (typeof v === "string") h[k] = v;
      out[id] = { n: typeof x.n === "string" ? x.n : "", h, ...(x.hidden ? { hidden: true } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

export const nameKey = (s: string) => s.trim().toLowerCase();

/** Числа и числовые строки базы сравниваем одинаково; пустое — null. */
function canon(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "number") return `n:${v}`;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) && /^-?[\d.]+$/.test(v))
    return `n:${Number(v)}`;
  return JSON.stringify(v);
}

/** Короткий отпечаток значения (FNV-1a): чтобы запись в app_settings не разрасталась. */
export function valueHash(v: unknown): string {
  const s = canon(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const sameValue = (a: unknown, b: unknown) => canon(a) === canon(b);

/**
 * Писать ли поле товара из таблицы.
 * - same: значение уже такое же;
 * - write: таблица им владеет (продавец не трогал с прошлого раза), или
 *   продавец разрешил перезапись, или это ручной запуск после предпросмотра,
 *   а таблица это поле ещё не писала;
 * - keep: продавец поправил поле в админке — оставляем его значение.
 */
export function decideField(a: {
  cur: unknown;
  next: unknown;
  rec: string | undefined;
  overwriteManual: boolean;
  interactive: boolean;
}): "same" | "write" | "keep" {
  if (sameValue(a.cur, a.next)) return "same";
  if (a.overwriteManual) return "write";
  if (a.rec === undefined) return a.interactive ? "write" : "keep";
  return valueHash(a.cur) === a.rec ? "write" : "keep";
}

/**
 * Какие товары из таблицы скрыть: только записанные в состоянии (пришли из
 * таблицы), которых в ней нет, и только при включённой настройке. Если
 * пропало подозрительно много — не скрываем ничего (guard), продавцу скажем.
 */
export function planHide(a: {
  hideMissing: boolean;
  state: SheetState;
  present: ReadonlySet<string>;
  existing: ReadonlyMap<string, { is_active: boolean }>;
}): { hide: string[]; guard: boolean } {
  if (!a.hideMissing) return { hide: [], guard: false };
  const managed = Object.keys(a.state).filter((id) => a.existing.has(id));
  const missing = managed.filter((id) => !a.present.has(id));
  const hide = missing.filter((id) => a.existing.get(id)!.is_active);
  if (missing.length >= HIDE_GUARD_MIN && missing.length * 2 > managed.length)
    return { hide: [], guard: true };
  return { hide, guard: false };
}
