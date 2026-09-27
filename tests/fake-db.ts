/**
 * База в памяти с подмножеством построителя запросов supabase-js — ровно
 * то, что нужно юнит-тестам на гонки (два запуска крона, повтор вебхука)
 * без живой Supabase. Уникальные ключи задаются явно, нарушение — ошибка
 * 23505, как у PostgREST. Каждый запрос отдаёт управление (await), так что
 * параллельные вызовы перемежаются, как в настоящей базе.
 *
 * Колонки в select, фильтрах, сортировке, вставках и onConflict сверяются
 * со схемой из src/core/db-types.ts: несуществующая — исключение, как 400
 * у PostgREST. Ошибку, которую код поймал и проглотил, всё равно видно:
 * она копится в schemaViolations, и tests/setup-env.ts валит тест.
 */
export const schemaViolations: string[] = [];
import { schemaColumns, selectColumns, baseColumn } from "./db-schema";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number };

export type FakeDb = {
  tables: Record<string, Row[]>;
  from: (table: string) => Query;
  rpc: (name: string, args: Record<string, unknown>) => Promise<Result>;
  /** Потолок строк одного ответа, как max-rows у PostgREST (там 1000). */
  maxRows: number;
};

export function fakeDb(
  opts: {
    unique?: Record<string, string[][]>;
    rpc?: Record<string, (db: FakeDb, args: Record<string, unknown>) => void>;
    /** Включить потолок ответа, как у Supabase: `maxRows: 1000`. */
    maxRows?: number;
  } = {},
): FakeDb {
  const db: FakeDb = {
    tables: {},
    maxRows: opts.maxRows ?? Infinity,
    from: (table) => new Query(db, table, opts.unique?.[table] ?? []),
    rpc: async (name, args) => {
      await Promise.resolve();
      const fn = opts.rpc?.[name];
      if (!fn) return { data: null, error: { message: `rpc ${name} not found` } };
      fn(db, args);
      return { data: null, error: null };
    },
  };
  return db;
}

let seq = 0;

/** Вхождение jsonb, как оператор @> : массив содержит все элементы, объект — все пары. */
function jsonContains(have: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return Array.isArray(have) && want.every((w) => have.some((h) => jsonContains(h, w)));
  if (want && typeof want === "object")
    return (
      Boolean(have) &&
      typeof have === "object" &&
      Object.entries(want).every(([k, w]) => jsonContains((have as Row)[k], w))
    );
  return have === want;
}

function jsonEqual(have: unknown, text: string): boolean {
  let want: unknown;
  try {
    want = JSON.parse(text);
  } catch {
    return false;
  }
  return jsonContains(have, want) && jsonContains(want, have);
}

/** Колонка или путь в jsonb «payload->>key», как в фильтрах PostgREST. */
function pick(r: Row, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return r[col];
  const obj = r[m[1]!];
  const v = obj && typeof obj === "object" ? (obj as Row)[m[2]!] : undefined;
  return v == null ? v : String(v);
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private conflictCol = "id";
  private filters: Filter[] = [];
  private payload: Row | Row[] = {};
  private returning = false;
  private headCount = false;
  private max = Infinity;
  private skip = 0;
  private sorts: Array<{ col: string; asc: boolean }> = [];
  private one: "single" | "maybe" | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
    private unique: string[][],
  ) {}

  /** Колонка есть в таблице? Таблица вне схемы (тестовая) не проверяется. */
  private col(expr: string): string {
    const known = schemaColumns().get(this.table);
    const name = baseColumn(expr);
    // `orders.status` — фильтр по встроенной связи: колонка другой таблицы.
    if (known && !name.includes(".") && !known.has(name)) {
      const msg = `fakeDb: в таблице ${this.table} нет колонки «${name}» (PostgREST ответил бы 400)`;
      schemaViolations.push(msg);
      throw new Error(msg);
    }
    return expr;
  }
  private cols(rows: Row | Row[]) {
    for (const r of Array.isArray(rows) ? rows : [rows])
      for (const k of Object.keys(r)) this.col(k);
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  select(cols?: string, o?: { count?: string; head?: boolean }) {
    if (cols) for (const c of selectColumns(cols)) this.col(c);
    if (this.op === "select") {
      this.headCount = Boolean(o?.head);
    } else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.cols(rows);
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  /** Вставка или замена по onConflict (одна колонка), как у PostgREST. */
  upsert(rows: Row | Row[], o?: { onConflict?: string }) {
    this.cols(rows);
    for (const c of (o?.onConflict ?? "").split(",")) if (c.trim()) this.col(c);
    this.op = "upsert";
    this.payload = rows;
    this.conflictCol = o?.onConflict ?? "id";
    return this;
  }
  update(patch: Row) {
    this.cols(patch);
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.col(col);
    // Колонка jsonb сравнивается с JSON-текстом по значению, как в PostgREST.
    this.filters.push((r) => {
      const have = pick(r, col);
      if (have !== null && typeof have === "object" && typeof v === "string")
        return jsonEqual(have, v);
      return have === v;
    });
    return this;
  }
  neq(col: string, v: unknown) {
    this.col(col);
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.col(col);
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  /** not(col, "in", "(a,b)") и not(col, "is", null) — как ими пользуется код. */
  not(col: string, op: "in" | "is", v: string | null) {
    this.col(col);
    if (op === "is") {
      if (v !== null) throw new Error(`fakeDb: not is ${v} не поддержан`);
      this.filters.push((r) => pick(r, col) != null);
      return this;
    }
    if (op !== "in") throw new Error(`fakeDb: not ${op} не поддержан`);
    const vs = String(v)
      .replace(/^\(|\)$/g, "")
      .split(",");
    this.filters.push((r) => !vs.includes(String(r[col])));
    return this;
  }
  /** contains по jsonb-объекту: все ключи образца совпадают (плоский @>). */
  contains(col: string, v: Record<string, unknown>) {
    this.col(col);
    this.filters.push((r) => {
      const obj = r[col] as Record<string, unknown> | null;
      return Boolean(obj) && Object.entries(v).every(([k, x]) => jsonContains(obj![k], x));
    });
    return this;
  }
  /** like с «%» на конце — префикс, как ими пользуется код. */
  like(col: string, pattern: string) {
    this.col(col);
    const re = likeRegex(pattern, "");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  /** ilike — как like, без учёта регистра. */
  ilike(col: string, pattern: string) {
    this.col(col);
    const re = likeRegex(pattern, "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  is(col: string, v: null) {
    this.col(col);
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  gt(col: string, v: string | number) {
    this.col(col);
    this.filters.push((r) => r[col] != null && (r[col] as string | number) > v);
    return this;
  }
  gte(col: string, v: string | number) {
    this.col(col);
    this.filters.push((r) => r[col] != null && (r[col] as string | number) >= v);
    return this;
  }
  lte(col: string, v: string | number) {
    this.col(col);
    this.filters.push((r) => r[col] != null && (r[col] as string | number) <= v);
    return this;
  }
  lt(col: string, v: string | number) {
    this.col(col);
    this.filters.push((r) => r[col] != null && (r[col] as string | number) < v);
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.col(col);
    this.sorts.push({ col, asc: o?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  /** Страница строк from..to включительно, как .range() у PostgREST. */
  range(from: number, to: number) {
    this.skip = from;
    this.max = to - from + 1;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private matching(): Row[] {
    let out = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.sorts.length) {
      out = [...out].sort((a, b) => {
        for (const { col, asc } of this.sorts) {
          const x = a[col] as string;
          const y = b[col] as string;
          if (x !== y) return x < y ? (asc ? -1 : 1) : asc ? 1 : -1;
        }
        return 0;
      });
    }
    return out.slice(this.skip, this.skip + this.max);
  }

  private conflict(candidate: Row, except?: Row): boolean {
    return this.unique.some((cols) =>
      this.rows().some(
        (r) => r !== except && cols.every((c) => r[c] != null && r[c] === candidate[c]),
      ),
    );
  }

  private shape(rows: Row[]): Result {
    if (this.one) {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
      if (!rows.length && this.one === "single")
        return { data: null, error: { message: "no rows" } };
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }

  private run(): Result {
    if (this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const r of list) {
        const col = this.conflictCol;
        const existing = this.rows().find((x) => x[col] != null && x[col] === r[col]);
        if (existing) Object.assign(existing, r);
        else this.rows().push({ id: `row-${++seq}`, created_at: new Date().toISOString(), ...r });
      }
      return { data: null, error: null };
    }
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const added: Row[] = [];
      for (const r of list) {
        const row = { id: `row-${++seq}`, ...r };
        if (this.conflict(row))
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          };
        this.rows().push(row);
        added.push(row);
      }
      return this.returning ? this.shape(added) : { data: null, error: null };
    }
    const hit = this.matching();
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.payload);
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = this.rows().filter((r) => !hit.includes(r));
      // .delete().select() отдаёт удалённые строки, как Prefer: return=representation.
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }
    if (this.headCount) return { data: null, error: null, count: hit.length };
    return this.shape(hit.slice(0, this.db.maxRows));
  }
}

/** Шаблон LIKE как в Postgres: «%» и «_» — подстановки, «\» экранирует следующий символ. */
function likeRegex(pattern: string, flags: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && i + 1 < pattern.length) out += escapeRe(pattern[++i]!);
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += escapeRe(c);
  }
  return new RegExp(`^${out}$`, flags + "s");
}

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
