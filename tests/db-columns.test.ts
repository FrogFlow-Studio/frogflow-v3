import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeDb, schemaViolations } from "./fake-db";
import { baseColumn, schemaColumns, selectColumns } from "./db-schema";

/**
 * Колонки в запросах сверяются со схемой (src/core/db-types.ts) двумя путями:
 * подставная база падает на несуществующей колонке в любом тесте, а здесь —
 * ещё и сам код без тестов: цепочки `.from("таблица")…` с колонками-строками.
 * Поймали бы #172: `.order("id")` у bot_users, где колонки id нет.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(p) && !p.endsWith(".test.ts") && !p.endsWith("db-types.ts"))
      out.push(p);
  }
  return out;
}

/** Колонки из цепочки одного запроса: до `;` или следующего `.from(`. */
function unknownColumns(file: string, src: string): string[] {
  const schema = schemaColumns();
  const bad: string[] = [];
  // storage.from("bucket") — не таблица.
  for (const m of src.matchAll(/(?<!storage\s*)\.from\(\s*"([a-z_]+)"\s*\)/g)) {
    const table = m[1]!;
    const cols = schema.get(table);
    if (!cols) continue;
    const rest = src.slice(m.index! + m[0].length);
    const stop = rest.search(/;|\.from\(/);
    const chain = rest.slice(0, stop < 0 ? 2000 : stop);
    const line = src.slice(0, m.index).split("\n").length;
    const check = (expr: string, how: string) => {
      const c = baseColumn(expr);
      if (!c.includes(".") && !cols.has(c)) bad.push(`${file}:${line} ${table}.${c} (${how})`);
    };
    for (const s of chain.matchAll(/\.select\(\s*"([^"]*)"/g))
      for (const c of selectColumns(s[1]!)) check(c, "select");
    for (const s of chain.matchAll(
      /\.(eq|neq|in|is|gt|gte|lt|lte|like|ilike|order|not|contains)\(\s*"([^"]+)"/g,
    ))
      check(s[2]!, s[1]!);
    for (const s of chain.matchAll(/onConflict:\s*"([^"]+)"/g))
      for (const c of s[1]!.split(",")) check(c, "onConflict");
  }
  return bad;
}

describe("колонки в запросах есть в схеме", () => {
  it("схема читается из db-types.ts", () => {
    const s = schemaColumns();
    expect(s.get("bot_users")).toContain("user_key");
    expect(s.get("bot_users")).not.toContain("id");
    expect(s.get("orders")).toContain("id");
  });

  it("подставная база падает на несуществующей колонке — в сортировке, фильтре, select и записи", () => {
    const db = fakeDb();
    expect(() => db.from("bot_users").select("user_key").order("id")).toThrow(/нет колонки «id»/);
    expect(() => db.from("bot_users").select("user_key, nope")).toThrow(/«nope»/);
    expect(() => db.from("orders").select("id").eq("payload->>x", 1)).toThrow(/«payload»/);
    expect(() => db.from("orders").insert({ bot_id: "b", nope: 1 })).toThrow(/«nope»/);
    expect(() =>
      db
        .from("app_settings")
        .upsert({ bot_id: "b", key: "k", value: "v" }, { onConflict: "bot_id,nope" }),
    ).toThrow(/«nope»/);
    // Встроенные связи и json-пути по настоящим колонкам — можно.
    expect(() =>
      db.from("orders").select("id, order_items(name_snapshot)").eq("id", 1),
    ).not.toThrow();
    expect(() => db.from("zernio_logs").select("id").eq("payload->>x", "1")).not.toThrow();
    // Таблица вне схемы (тестовая) не проверяется.
    expect(() => db.from("scratch").select("anything").order("whatever")).not.toThrow();
    // Проглоченная кодом ошибка всё равно видна тесту (tests/setup-env.ts).
    expect(schemaViolations.splice(0)).toHaveLength(5);
  });

  it("код не обращается к несуществующим колонкам (цепочки .from(…) со строками)", () => {
    const bad = sources("src").flatMap((f) => unknownColumns(f, readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("проверка кода ловит ошибку вида #172", () => {
    const src = `await ctx.db.from("bot_users").select("user_key").order("id").range(0, 9);`;
    expect(unknownColumns("x.ts", src)).toEqual(["x.ts:1 bot_users.id (order)"]);
  });
});

describe("таблицы сообщества (миграция 19-2) описаны в схеме", () => {
  it("темы, ответы и жалобы с ключевыми колонками", () => {
    const s = schemaColumns();
    expect([...s.get("community_threads")!]).toEqual(
      expect.arrayContaining(["bot_id", "section", "topic", "title", "hidden", "last_post_at"]),
    );
    expect([...s.get("community_posts")!]).toEqual(
      expect.arrayContaining(["thread_id", "bot_id", "body", "hidden"]),
    );
    expect([...s.get("community_reports")!]).toEqual(
      expect.arrayContaining(["bot_id", "thread_id", "post_id", "status"]),
    );
  });
});

describe("таблица личных сообщений сообщества (миграция 19-3) описана в схеме", () => {
  it("community_dm с ключевыми колонками", () => {
    expect([...schemaColumns().get("community_dm")!]).toEqual(
      expect.arrayContaining(["from_bot_id", "to_bot_id", "body", "read_at", "notified_at"]),
    );
  });
});

/**
 * Миграции партии 19 (migrations/19-*.sql) и типы базы описывают одни и те же
 * таблицы: колонка, добавленная в одном месте и забытая в другом, ломает
 * запросы только на живой базе. Сверяем имена колонок каждой новой таблицы.
 */
describe("миграции партии 19 совпадают с db-types.ts", () => {
  const dir = "migrations";
  const files = readdirSync(dir).filter(
    (f) => /^(19|20)-.*\.sql$/.test(f) && !f.endsWith(".down.sql"),
  );

  it("миграции нашлись и у каждой есть откат", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readdirSync(dir)).toContain(f.replace(/\.sql$/, ".down.sql"));
  });

  it("колонки таблиц в SQL и в типах одни и те же", () => {
    const schema = schemaColumns();
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const m of sql.matchAll(
        /CREATE TABLE IF NOT EXISTS (?:public\.)?(\w+) \(\n([\s\S]*?)\n\);/gi,
      )) {
        const cols = [
          ...m[2]!.matchAll(
            /^ {2}(?!(?:primary|unique|check|foreign|constraint)\b)([a-z][a-z0-9_]*)\s+[a-z]/gim,
          ),
        ]
          .map((c) => c[1]!)
          .sort();
        const typed = [...(schema.get(m[1]!) ?? [])].sort();
        expect(typed, `${f}: ${m[1]}`).toEqual(cols);
      }
    }
  });

  it("новые миграции только добавляют: ни ALTER существующего, ни DROP таблиц, ни DELETE", () => {
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      expect(sql, f).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\b/i);
      // ALTER TABLE — только по таблицам, которые эта же миграция создаёт.
      const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?(\w+)/gi)].map(
        (c) => c[1],
      );
      for (const a of sql.matchAll(/ALTER TABLE (?:public\.)?(\w+)/gi))
        expect(created, f).toContain(a[1]);
    }
  });
});

describe("таблица площадки (миграция 19-7) описана в схеме", () => {
  it("каталог магазинов с ключевыми колонками", () => {
    expect([...schemaColumns().get("marketplace_shops")!]).toEqual(
      expect.arrayContaining([
        "bot_id",
        "slug",
        "name",
        "category",
        "city",
        "rating",
        "updated_at",
      ]),
    );
  });
});

describe("таблицы совместных акций (миграция 19-4) описаны в схеме", () => {
  it("joint_promos и joint_promo_members с ключевыми колонками", () => {
    const s = schemaColumns();
    expect([...s.get("joint_promos")!]).toEqual(
      expect.arrayContaining(["created_by", "title", "ends_at", "status"]),
    );
    expect([...s.get("joint_promo_members")!]).toEqual(
      expect.arrayContaining([
        "promo_id",
        "bot_id",
        "status",
        "code",
        "discount_percent",
        "promo_code_id",
        "notified_at",
      ]),
    );
  });
});

/**
 * Индексы партии 20 (migrations/20-*.sql): каждый строится на таблице и колонках,
 * которые есть в схеме (db-types.ts), иначе миграция упадёт на живой базе.
 */
describe("индексы партии 20 строятся на колонках схемы", () => {
  const dir = "migrations";
  const files = readdirSync(dir).filter((f) => /^20-.*\.sql$/.test(f) && !f.endsWith(".down.sql"));

  it("миграции нашлись и у каждой есть откат", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readdirSync(dir)).toContain(f.replace(/\.sql$/, ".down.sql"));
  });

  it("таблица и колонки каждого CREATE INDEX есть в схеме", () => {
    const schema = schemaColumns();
    let seen = 0;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      // Индексы в DO-блоке (format(...)) тоже: таблица и колонка идут сразу после ON … USING gin (…).
      for (const m of sql.matchAll(
        /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON (?:public\.)?(\w+)\s*(?:USING \w+\s*)?\(([^)]*)\)/gi,
      )) {
        seen++;
        const cols = schema.get(m[1]!);
        expect(cols, `${f}: таблицы ${m[1]} нет в схеме`).toBeDefined();
        for (const part of m[2]!.split(",")) {
          const col = part.trim().split(/\s+/)[0]!.replace(/^%I\./, "");
          expect(cols!.has(col), `${f}: ${m[1]}.${col}`).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6);
  });

  it("новые индексы только добавляют: ни DROP, ни DELETE, ни ALTER, ни CREATE TABLE", () => {
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      expect(sql, f).not.toMatch(/\b(DROP|DELETE|ALTER|UPDATE|TRUNCATE|CREATE TABLE)\b/i);
    }
  });
});
