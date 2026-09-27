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
