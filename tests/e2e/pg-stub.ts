/**
 * Подставная Supabase с памятью для сквозного прогона денежного пути: заказ,
 * оплата, подтверждение, выдача, счёт оператора. Понимает то подмножество
 * PostgREST, Storage и Telegram Bot API, которым пользуется приложение, и
 * хранит всё в памяти процесса. Настоящую базу прогон не трогает.
 *
 * Тест читает состояние и сообщения бота через служебные адреса /__e2e/*.
 * API Zernio — под /zernio/v1 (ZERNIO_BASE_URL), как Telegram в #159.
 */
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { baseColumn, schemaColumns, selectColumns } from "../db-schema.ts";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export type Rpc = (db: StubDb, args: Row) => unknown;

export type StubDb = {
  tables: Tables;
  /** Ключи уникальности по таблицам, кроме id: нарушение — 23505, как в Postgres. */
  unique: Record<string, string[][]>;
  /** Значения по умолчанию при вставке (как DEFAULT в схеме). */
  defaults: Record<string, (row: Row, db: StubDb) => Row>;
  /** AFTER INSERT/UPDATE: то, что в настоящей базе делают триггеры. */
  after: Record<string, (row: Row, db: StubDb) => void>;
  rpc: Record<string, Rpc>;
  storage: Map<string, { body: Buffer; type: string }>;
  telegram: { method: string; token: string; body: Row }[];
  /** Участники групп Telegram: «<chat_id>:<user_id>» (VIP-группа, vip.spec.ts). */
  members: Set<string>;
  /** Запросы к API Zernio (Instagram/WhatsApp): что приложение отправило покупателю. */
  zernio: { method: string; path: string; body: Row }[];
  /** Правила Comment-to-DM в Zernio (`/comment-automations`): список и правка. */
  zernioAutomations: Row[];
};

const rows = (db: StubDb, t: string) => (db.tables[t] ??= []);

/* ── фильтры PostgREST ──────────────────────────────────────────── */

function pick(r: Row, col: string): unknown {
  const m = /^(\w+)(?:->>?(\w+))?$/.exec(col);
  if (!m) return undefined;
  const v = r[m[1]!];
  if (!m[2]) return v;
  const inner = v && typeof v === "object" ? (v as Row)[m[2]] : undefined;
  return col.includes("->>") && inner != null ? String(inner) : inner;
}

function unquote(s: string) {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s;
}

/** Разбор списка через запятую с учётом скобок и кавычек: or=(a.eq.1,and(b.is.null,c.gt.2)). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function cmp(a: unknown, b: string): number {
  const na = typeof a === "number" ? a : Number(a);
  const nb = Number(b);
  if (a !== null && a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(b);
}

function likeRe(p: string, flags: string) {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*");
  return new RegExp(`^${esc}$`, flags);
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Условие «op.value» над значением колонки. */
function test(v: unknown, expr: string): boolean {
  if (expr.startsWith("not.")) return !test(v, expr.slice(4));
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  switch (op) {
    case "eq":
      return v !== null && v !== undefined && asText(v) === unquote(val);
    case "neq":
      return v !== null && v !== undefined && asText(v) !== unquote(val);
    case "gt":
      return v != null && cmp(v, unquote(val)) > 0;
    case "gte":
      return v != null && cmp(v, unquote(val)) >= 0;
    case "lt":
      return v != null && cmp(v, unquote(val)) < 0;
    case "lte":
      return v != null && cmp(v, unquote(val)) <= 0;
    case "like":
      return v != null && likeRe(unquote(val), "").test(asText(v));
    case "ilike":
      return v != null && likeRe(unquote(val), "i").test(asText(v));
    case "is":
      if (val === "null") return v === null || v === undefined;
      if (val === "true") return v === true;
      if (val === "false") return v === false;
      return false;
    case "in": {
      const list = splitTop(val.replace(/^\(|\)$/g, "")).map(unquote);
      return v != null && list.includes(asText(v));
    }
    case "cs": {
      // Содержит: jsonb-объект/массив или массив Postgres {a,b}.
      if (val.startsWith("{") && !val.startsWith('{"') && Array.isArray(v)) {
        const need = val
          .replace(/^\{|\}$/g, "")
          .split(",")
          .filter(Boolean)
          .map(unquote);
        return need.every((x) => (v as unknown[]).map(asText).includes(x));
      }
      return contains(v, JSON.parse(val));
    }
    default:
      throw new Error(`pg-stub: оператор ${op} не поддержан`);
  }
}

function contains(have: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  if (want && typeof want === "object")
    return (
      Boolean(have) &&
      typeof have === "object" &&
      Object.entries(want).every(([k, w]) => contains((have as Row)[k], w))
    );
  return have === want;
}

/** Выражение внутри or=(...)/and=(...): «col.op.val», «not.and(...)», «and(...)». */
function logic(r: Row, expr: string): boolean {
  const neg = expr.startsWith("not.");
  const e = neg ? expr.slice(4) : expr;
  let out: boolean;
  const g = /^(and|or)\((.*)\)$/.exec(e);
  if (g) {
    const parts = splitTop(g[2]!);
    out = g[1] === "and" ? parts.every((p) => logic(r, p)) : parts.some((p) => logic(r, p));
  } else {
    const dot = e.indexOf(".");
    out = test(pick(r, e.slice(0, dot)), e.slice(dot + 1));
  }
  return neg ? !out : out;
}

type Parsed = {
  filters: ((r: Row) => boolean)[];
  embedFilters: Map<string, [string, string][]>;
  order: { col: string; asc: boolean; nullsFirst: boolean }[];
  limit: number;
  offset: number;
  select: string;
  onConflict: string | null;
};

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseQuery(url: URL): Parsed {
  const p: Parsed = {
    filters: [],
    embedFilters: new Map(),
    order: [],
    limit: Infinity,
    offset: 0,
    select: url.searchParams.get("select") ?? "*",
    onConflict: url.searchParams.get("on_conflict"),
  };
  for (const [k, v] of url.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === "or" || k === "and" || k === "not.or" || k === "not.and") {
      const expr = `${k}${v}`;
      p.filters.push((r) => logic(r, expr));
      continue;
    }
    // Фильтр по встроенной таблице: order_items.product_id=eq.x
    if (/^[a-z_]+\.[a-z_]/.test(k) && !k.includes("->")) {
      const [rel, col] = [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)];
      if (RESERVED.has(col) || col === "order" || col === "limit") continue;
      const list = p.embedFilters.get(rel) ?? [];
      list.push([col, v]);
      p.embedFilters.set(rel, list);
      continue;
    }
    p.filters.push((r) => test(pick(r, k), v));
  }
  const order = url.searchParams.get("order");
  if (order)
    for (const part of order.split(",")) {
      const [col, ...mods] = part.split(".");
      const asc = !mods.includes("desc");
      p.order.push({
        col: col!,
        asc,
        nullsFirst: mods.includes("nullsfirst") || (!asc && !mods.includes("nullslast")),
      });
    }
  const limit = url.searchParams.get("limit");
  if (limit) p.limit = Number(limit);
  const offset = url.searchParams.get("offset");
  if (offset) p.offset = Number(offset);
  return p;
}

/**
 * Колонка запроса, которой нет в таблице (схема — src/core/db-types.ts), или
 * null. Настоящий PostgREST на такой ответит 400 (42703) — заглушка тоже,
 * иначе сквозной прогон зеленел бы на запросе, который упадёт в проде.
 */
function unknownColumn(table: string, url: URL, body: Buffer): string | null {
  const known = schemaColumns().get(table);
  if (!known) return null;
  const miss = (expr: string) => {
    const c = baseColumn(expr);
    return !c.includes(".") && !known.has(c) ? c : null;
  };
  const found: (string | null)[] = [];
  for (const c of selectColumns(url.searchParams.get("select") ?? "*")) found.push(miss(c));
  for (const [k] of url.searchParams) {
    if (RESERVED.has(k) || /^(not\.)?(or|and)$/.test(k)) continue;
    if (/^[a-z_]+\.[a-z_]/.test(k) && !k.includes("->")) continue; // встроенная таблица
    found.push(miss(k));
  }
  for (const part of (url.searchParams.get("order") ?? "").split(","))
    if (part) found.push(miss(part.split(".")[0]!));
  for (const c of (url.searchParams.get("on_conflict") ?? "").split(","))
    if (c) found.push(miss(c));
  if (body.length) {
    const payload = JSON.parse(body.toString()) as Row | Row[];
    for (const r of Array.isArray(payload) ? payload : [payload])
      for (const k of Object.keys(r)) found.push(miss(k));
  }
  return found.find((c) => c !== null) ?? null;
}

/* ── встроенные таблицы: select=*,order_items(*),products(name) ─── */

type Embed = { alias: string; table: string; inner: boolean; select: string };

function parseSelect(select: string): { cols: string[]; embeds: Embed[] } {
  const cols: string[] = [];
  const embeds: Embed[] = [];
  for (const raw of splitTop(select.replace(/\s+/g, ""))) {
    const m = /^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/.exec(raw);
    if (m)
      embeds.push({ alias: m[1] ?? m[2]!, table: m[2]!, inner: m[3] === "inner", select: m[4]! });
    else cols.push(raw);
  }
  return { cols, embeds };
}

/** Внешние ключи, чьё имя не выводится из имени таблицы (vip_subscriptions.tariff_id). */
const FK_COLUMN: Record<string, Record<string, string>> = {
  vip_subscriptions: { vip_tariffs: "tariff_id" },
  vip_member_profiles: { vip_tariffs: "assigned_tariff_id" },
};

const singular = (t: string) => t.replace(/ies$/, "y").replace(/s$/, "");

function shape(
  db: StubDb,
  table: string,
  r: Row,
  select: string,
  embedFilters: Parsed["embedFilters"],
): Row | null {
  const { cols, embeds } = parseSelect(select);
  let out: Row = {};
  if (cols.length === 0 || cols.includes("*")) out = { ...r };
  for (const c of cols) {
    if (c === "*") continue;
    const m = /^(?:(\w+):)?([\w>-]+?)(?:::\w+)?$/.exec(c);
    if (!m) continue;
    const key = m[1] ?? m[2]!.replace(/.*->>?/, "");
    out[key] = pick(r, m[2]!);
  }
  for (const e of embeds) {
    const fk = FK_COLUMN[table]?.[e.table] ?? `${singular(e.table)}_id`;
    const back = `${singular(table)}_id`;
    const filters = embedFilters.get(e.alias) ?? embedFilters.get(e.table) ?? [];
    const ok = (x: Row) => filters.every(([c, v]) => test(pick(x, c), v));
    if (fk in r) {
      // Многие-к-одному: order_items.product_id → products.
      const parent = rows(db, e.table).find((x) => x.id === r[fk]);
      const val = parent && ok(parent) ? shape(db, e.table, parent, e.select, new Map()) : null;
      if (e.inner && !val) return null;
      out[e.alias] = val;
    } else {
      const kids = rows(db, e.table)
        .filter((x) => x[back] === r.id && ok(x))
        .map((x) => shape(db, e.table, x, e.select, new Map())!);
      if (e.inner && kids.length === 0) return null;
      out[e.alias] = kids;
    }
  }
  return out;
}

function sortRows(list: Row[], order: Parsed["order"]) {
  if (!order.length) return list;
  return [...list].sort((a, b) => {
    for (const o of order) {
      const va = pick(a, o.col);
      const vb = pick(b, o.col);
      if (va == null && vb == null) continue;
      if (va == null) return o.nullsFirst ? -1 : 1;
      if (vb == null) return o.nullsFirst ? 1 : -1;
      const d =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      if (d) return o.asc ? d : -d;
    }
    return 0;
  });
}

/* ── запись ─────────────────────────────────────────────────────── */

class PgError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function keysOf(db: StubDb, table: string): string[][] {
  return [["id"], ...(db.unique[table] ?? [])];
}

function clash(
  db: StubDb,
  table: string,
  row: Row,
  keys: string[][],
  except?: Row,
): Row | undefined {
  for (const k of keys) {
    if (k.some((c) => row[c] === undefined || row[c] === null)) continue;
    const hit = rows(db, table).find(
      (x) => x !== except && k.every((c) => asText(x[c]) === asText(row[c])),
    );
    if (hit) return hit;
  }
  return undefined;
}

function withDefaults(db: StubDb, table: string, row: Row): Row {
  const now = new Date().toISOString();
  const extra = db.defaults[table]?.(row, db) ?? {};
  return { id: randomUUID(), created_at: now, updated_at: now, ...extra, ...row };
}

function insert(
  db: StubDb,
  table: string,
  input: Row[],
  upsert: null | { cols: string[]; ignore: boolean },
): Row[] {
  const out: Row[] = [];
  for (const raw of input) {
    if (upsert) {
      const hit = clash(db, table, raw, [upsert.cols]);
      if (hit) {
        if (!upsert.ignore) {
          Object.assign(hit, raw);
          out.push(hit);
        }
        continue;
      }
    }
    const row = withDefaults(db, table, raw);
    if (clash(db, table, row, keysOf(db, table)))
      throw new PgError("23505", `duplicate key value violates unique constraint on ${table}`);
    rows(db, table).push(row);
    db.after[table]?.(row, db);
    out.push(row);
  }
  return out;
}

/**
 * Роль из ключа запроса. Ключ арендатора — JWT с bot_id: как RLS в
 * настоящей базе, он видит и меняет только строки своего магазина, а при
 * вставке bot_id ставится сам (триггер force_bot_id). Ключ платформы видит всё.
 */
function tenantOf(req: IncomingMessage): string | null {
  const auth = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  const part = auth.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString()) as Row;
    return claims.role === "tenant_bot" ? String(claims.bot_id) : null;
  } catch {
    return null;
  }
}

/* ── HTTP ───────────────────────────────────────────────────────── */

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function rest(db: StubDb, req: IncomingMessage, url: URL, body: Buffer, res: ServerResponse) {
  const table = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
  const prefer = String(req.headers.prefer ?? "");
  const accept = String(req.headers.accept ?? "");
  const single = accept.includes("vnd.pgrst.object");
  const q = parseQuery(url);
  const method = req.method ?? "GET";
  const tenant = tenantOf(req);
  if (tenant)
    q.filters.unshift((r) =>
      table === "bots" ? r.id === tenant : !("bot_id" in r) || r.bot_id === tenant,
    );

  if (table.startsWith("rpc/")) {
    const fn = db.rpc[table.slice(4)];
    if (!fn) return send(res, 404, { code: "PGRST202", message: `rpc ${table} not found` });
    const args = body.length
      ? (JSON.parse(body.toString()) as Row)
      : Object.fromEntries(url.searchParams);
    return send(res, 200, fn(db, args) ?? null);
  }

  const missing = unknownColumn(table, url, body);
  if (missing) {
    console.error(`[pg-stub] ${method} ${table}: нет колонки «${missing}»`);
    return send(res, 400, {
      code: "42703",
      message: `column ${table}.${missing} does not exist`,
      details: null,
      hint: null,
    });
  }

  const reply = (list: Row[], total?: number) => {
    const shaped = list
      .map((r) => shape(db, table, r, q.select, q.embedFilters))
      .filter((r): r is Row => r !== null);
    const headers: Record<string, string> = {};
    if (/count=/.test(prefer))
      headers["content-range"] = `0-${Math.max(shaped.length - 1, 0)}/${total ?? shaped.length}`;
    if (single) {
      if (shaped.length !== 1)
        return send(res, 406, {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `${shaped.length} rows`,
          hint: null,
        });
      return send(res, 200, shaped[0], headers);
    }
    return send(res, method === "POST" ? 201 : 200, shaped, headers);
  };
  const minimal = !/return=representation/.test(prefer) && method !== "GET" && method !== "HEAD";

  if (method === "GET" || method === "HEAD") {
    let list = rows(db, table).filter((r) => q.filters.every((f) => f(r)));
    // !inner по встроенной таблице отсекает строки ещё до limit.
    list = list.filter((r) => shape(db, table, r, q.select, q.embedFilters) !== null);
    const total = list.length;
    list = sortRows(list, q.order).slice(q.offset, q.offset + q.limit);
    if (method === "HEAD") {
      res.writeHead(200, { "content-range": `0-0/${total}` });
      return res.end();
    }
    return reply(list, total);
  }

  const payload = body.length ? (JSON.parse(body.toString()) as Row | Row[]) : {};
  if (method === "POST") {
    const list = (Array.isArray(payload) ? payload : [payload]).map((r) =>
      tenant ? { ...r, bot_id: tenant } : r,
    );
    const upsert = /resolution=(merge|ignore)-duplicates/.exec(prefer);
    const done = insert(
      db,
      table,
      list,
      upsert ? { cols: (q.onConflict ?? "id").split(","), ignore: upsert[1] === "ignore" } : null,
    );
    if (minimal)
      return send(
        res,
        201,
        undefined,
        /count=/.test(prefer) ? { "content-range": `*/${done.length}` } : {},
      );
    return reply(done);
  }
  if (method === "PATCH") {
    const hit = rows(db, table).filter((r) => q.filters.every((f) => f(r)));
    for (const r of hit) {
      const next = { ...r, ...(payload as Row) };
      if (clash(db, table, next, keysOf(db, table), r))
        throw new PgError("23505", `duplicate key value violates unique constraint on ${table}`);
      Object.assign(r, payload, { updated_at: new Date().toISOString() });
      db.after[table]?.(r, db);
    }
    if (minimal)
      return send(
        res,
        204,
        undefined,
        /count=/.test(prefer) ? { "content-range": `*/${hit.length}` } : {},
      );
    return reply(hit);
  }
  if (method === "DELETE") {
    const all = rows(db, table);
    const hit = all.filter((r) => q.filters.every((f) => f(r)));
    db.tables[table] = all.filter((r) => !hit.includes(r));
    if (minimal)
      return send(
        res,
        204,
        undefined,
        /count=/.test(prefer) ? { "content-range": `*/${hit.length}` } : {},
      );
    return reply(hit);
  }
  return send(res, 405, { message: `method ${method}` });
}

/** Storage: загрузка, скачивание, подписанные ссылки. Ключ — «bucket/path». */
function storage(
  db: StubDb,
  req: IncomingMessage,
  url: URL,
  body: Buffer,
  res: ServerResponse,
  base: string,
) {
  const p = decodeURIComponent(url.pathname.slice("/storage/v1/".length));
  const method = req.method ?? "GET";
  const notFound = () =>
    send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
  let m: RegExpExecArray | null;
  if (method === "POST" && (m = /^object\/sign\/(.+)$/.exec(p))) {
    const parsed = body.length ? (JSON.parse(body.toString()) as { paths?: string[] }) : {};
    if (parsed.paths) {
      const bucket = m[1]!;
      return send(
        res,
        200,
        parsed.paths.map((path) => ({
          path,
          error: db.storage.has(`${bucket}/${path}`) ? null : "Object not found",
          signedURL: `/object/sign/${bucket}/${path}?token=e2e`,
        })),
      );
    }
    if (!db.storage.has(m[1]!)) return notFound();
    return send(res, 200, { signedURL: `/object/sign/${m[1]}?token=e2e` });
  }
  if (
    (method === "GET" || method === "HEAD") &&
    (m = /^object\/(?:sign|public|authenticated)\/(.+)$/.exec(p))
  ) {
    const f = db.storage.get(m[1]!);
    if (!f) return notFound();
    res.writeHead(200, { "content-type": f.type });
    return res.end(method === "HEAD" ? undefined : f.body);
  }
  if ((method === "POST" || method === "PUT") && (m = /^object\/(.+)$/.exec(p))) {
    db.storage.set(m[1]!, {
      body,
      type: String(req.headers["content-type"] ?? "application/octet-stream"),
    });
    return send(res, 200, { Key: m[1], Id: randomUUID() });
  }
  if (method === "GET" && (m = /^object\/info\/(.+)$/.exec(p))) {
    // bucket.info(): размер и тип — по ним Instagram/WhatsApp решают, слать ли фото.
    const f = db.storage.get(m[1]!);
    if (!f) return notFound();
    return send(res, 200, { name: m[1], size: f.body.length, content_type: f.type });
  }
  if (method === "GET" && (m = /^object\/(.+)$/.exec(p))) {
    const f = db.storage.get(m[1]!);
    if (!f) return notFound();
    res.writeHead(200, { "content-type": f.type });
    return res.end(f.body);
  }
  if (method === "DELETE" && (m = /^object\/([^/]+)$/.exec(p))) {
    const parsed = body.length ? (JSON.parse(body.toString()) as { prefixes?: string[] }) : {};
    for (const x of parsed.prefixes ?? []) db.storage.delete(`${m[1]}/${x}`);
    return send(res, 200, []);
  }
  if (method === "POST" && (m = /^object\/list\/(.+)$/.exec(p))) {
    const parsed = JSON.parse(body.toString() || "{}") as { prefix?: string };
    const prefix = `${m[1]}/${parsed.prefix ? `${parsed.prefix.replace(/\/$/, "")}/` : ""}`;
    const names = [...db.storage.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ name: k.slice(prefix.length), id: k, metadata: {} }));
    return send(res, 200, names);
  }
  void base;
  return send(res, 400, {
    statusCode: "400",
    error: "unsupported",
    message: `storage ${method} ${p}`,
  });
}

/** Картинка 1×1 PNG — «фото чека», которое бот скачивает через getFile. */
export const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Та же картинка с текстовым чанком tEXt перед IEND — другое содержимое PNG. */
export function pngWithText(text: string): Buffer {
  const data = Buffer.concat([Buffer.from("Comment\0"), Buffer.from(text)]);
  const type = Buffer.from("tEXt");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const iend = PIXEL_PNG.length - 12;
  return Buffer.concat([
    PIXEL_PNG.subarray(0, iend),
    len,
    type,
    data,
    crc,
    PIXEL_PNG.subarray(iend),
  ]);
}

let messageId = 1000;

/** Telegram Bot API: всё записываем, отвечаем как Telegram. */
async function telegram(
  db: StubDb,
  req: IncomingMessage,
  url: URL,
  body: Buffer,
  res: ServerResponse,
) {
  const file = /^\/file\/bot[^/]+\/(.+)$/.exec(url.pathname);
  if (file) {
    // У каждого file_id своя картинка: разные чеки не должны считаться
    // повтором одного (сверка по отпечатку содержимого, core/orders/proof-hash).
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(pngWithText(file[1]!));
  }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname)!;
  const [, token, method] = m;
  const type = String(req.headers["content-type"] ?? "");
  let args: Row = {};
  if (type.includes("application/json") && body.length) args = JSON.parse(body.toString()) as Row;
  else if (type.includes("multipart/form-data")) {
    // Файл нам не нужен — только текстовые поля (chat_id, caption, reply_markup).
    const text = body.toString("latin1");
    for (const part of text.split(/--[^\r\n]+\r\n/)) {
      const name = /name="([^"]+)"(?:; filename="([^"]*)")?/.exec(part);
      if (!name) continue;
      const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
      args[name[1]!] =
        name[2] !== undefined
          ? { filename: Buffer.from(name[2], "latin1").toString("utf8"), bytes: value.length }
          : Buffer.from(value, "latin1").toString("utf8");
    }
  } else if (body.length) args = Object.fromEntries(new URLSearchParams(body.toString()));
  db.telegram.push({ method: method!, token: token!, body: args });
  const chat = { id: Number(args.chat_id ?? 0), type: "private" };
  const now = Math.floor(Date.now() / 1000);
  const result = (() => {
    switch (method) {
      case "getMe":
        return { id: 700000001, is_bot: true, first_name: "E2E", username: "e2e_shop_bot" };
      case "getFile":
        return {
          file_id: args.file_id,
          file_unique_id: "u",
          file_size: PIXEL_PNG.length,
          file_path: `photos/${String(args.file_id)}.png`,
        };
      case "getWebhookInfo":
        return { url: "", pending_update_count: 0 };
      case "createChatInviteLink":
        return {
          invite_link: `https://t.me/+e2e${++messageId}`,
          creator: { id: 1, is_bot: true },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
          name: args.name,
        };
      case "getChatMember":
        return {
          status: db.members.has(`${String(args.chat_id)}:${String(args.user_id)}`)
            ? "member"
            : "left",
          user: { id: Number(args.user_id), is_bot: false, first_name: "E2E" },
        };
      case "banChatMember":
        db.members.delete(`${String(args.chat_id)}:${String(args.user_id)}`);
        return true;
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument":
      case "sendMediaGroup":
      case "copyMessage":
        return method === "sendMediaGroup"
          ? [{ message_id: ++messageId, date: now, chat }]
          : { message_id: ++messageId, date: now, chat, text: args.text };
      case "editMessageText":
      case "editMessageReplyMarkup":
      case "editMessageCaption":
        return { message_id: Number(args.message_id ?? 0), date: now, chat, text: args.text };
      default:
        return true;
    }
  })();
  return send(res, 200, { ok: true, result });
}

/**
 * API Zernio: исходящие сообщения записываем и отвечаем успехом, вложения
 * покупателя (/zernio/media/<имя>) отдаём картинкой со своим содержимым —
 * разные чеки не совпадают по отпечатку.
 */
function zernio(db: StubDb, req: IncomingMessage, url: URL, body: Buffer, res: ServerResponse) {
  const path = url.pathname.slice("/zernio".length);
  const media = /^\/media\/(.+)$/.exec(path);
  if (media) {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(pngWithText(media[1]!));
  }
  const args = body.length ? (JSON.parse(body.toString()) as Row) : {};
  db.zernio.push({ method: req.method ?? "GET", path: path + url.search, body: args });
  if (path.startsWith("/v1/comment-automations")) {
    const id = /^\/v1\/comment-automations\/([^/?]+)$/.exec(path)?.[1];
    if (req.method === "GET" && !id) return send(res, 200, { automations: db.zernioAutomations });
    const rule = db.zernioAutomations.find((a) => a.id === decodeURIComponent(id ?? ""));
    if (req.method === "PATCH" && rule) {
      Object.assign(rule, args);
      return send(res, 200, { success: true, automation: rule });
    }
    return send(res, 404, { error: "automation not found" });
  }
  if (req.method === "GET" && /\/inbox\/conversations\/[^/]+\/messages$/.test(path))
    return send(res, 200, { messages: [] });
  if (req.method === "POST" && /\/inbox\/conversations\/[^/]+\/messages$/.test(path))
    return send(res, 200, { success: true, data: { messageId: `zm-${++messageId}` } });
  return send(res, 200, { success: true });
}

export function stubDb(init: Partial<StubDb> = {}): StubDb {
  return {
    tables: {},
    unique: {},
    defaults: {},
    after: {},
    rpc: {},
    storage: new Map(),
    telegram: [],
    members: new Set(),
    zernio: [],
    zernioAutomations: [],
    ...init,
  };
}

/**
 * Сервер подставной Supabase + Telegram на одном порту. `/__e2e/*` — для
 * теста: состояние таблиц, сообщения бота, запись строк.
 */
export function startPgStub(port: number, db: StubDb) {
  const base = `http://127.0.0.1:${port}`;
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", base);
      const body = await readBody(req);
      try {
        if (url.pathname.startsWith("/rest/v1/")) return rest(db, req, url, body, res);
        if (url.pathname.startsWith("/storage/v1/")) return storage(db, req, url, body, res, base);
        if (/^\/(bot|file\/bot)/.test(url.pathname)) return await telegram(db, req, url, body, res);
        if (url.pathname.startsWith("/zernio/")) return zernio(db, req, url, body, res);
        if (url.pathname === "/__e2e/telegram") return send(res, 200, db.telegram);
        if (url.pathname === "/__e2e/zernio") return send(res, 200, db.zernio);
        const t = /^\/__e2e\/tables\/(\w+)$/.exec(url.pathname);
        if (t && req.method === "GET") return send(res, 200, rows(db, t[1]!));
        if (t && req.method === "POST") {
          const list = JSON.parse(body.toString()) as Row[];
          return send(res, 201, insert(db, t[1]!, list, null));
        }
        // Покупатель вошёл в группу по ссылке: getChatMember дальше отвечает «member».
        if (url.pathname === "/__e2e/telegram/join" && req.method === "POST") {
          const j = JSON.parse(body.toString()) as { chat_id: string; user_id: number };
          db.members.add(`${j.chat_id}:${j.user_id}`);
          return send(res, 200, { ok: true });
        }
        // Сдвинуть время в строке (срок подписки): PATCH /__e2e/tables/<t>/<id>.
        const one = /^\/__e2e\/tables\/(\w+)\/([\w-]+)$/.exec(url.pathname);
        if (one && req.method === "PATCH") {
          const hit = rows(db, one[1]!).find((r) => String(r.id) === one[2]);
          if (!hit) return send(res, 404, { message: "no row" });
          Object.assign(hit, JSON.parse(body.toString()) as Row);
          return send(res, 200, hit);
        }
        if (url.pathname === "/__e2e/storage") return send(res, 200, [...db.storage.keys()]);
        return send(res, 404, { message: `pg-stub: ${req.method} ${url.pathname}` });
      } catch (e) {
        if (e instanceof PgError)
          return send(res, e.status, {
            code: e.code,
            message: e.message,
            details: null,
            hint: null,
          });
        console.error("[pg-stub]", req.method, url.pathname + url.search, e);
        return send(res, 500, {
          code: "XX000",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });
  return new Promise<() => Promise<void>>((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve(() => new Promise<void>((r) => server.close(() => r()))),
    ),
  );
}
