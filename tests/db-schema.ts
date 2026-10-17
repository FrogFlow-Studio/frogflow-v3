import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Колонки таблиц из src/core/db-types.ts (блок Row каждой таблицы) — чтобы
 * подставная база (tests/fake-db.ts) падала на колонке, которой в базе нет,
 * как настоящий PostgREST (400, 42703). Файл типов читается как текст: он и
 * есть описание схемы, отдельной копии не заводим.
 */
let cache: Map<string, Set<string>> | null = null;

export function schemaColumns(): Map<string, Set<string>> {
  if (cache) return cache;
  const src = readFileSync(
    fileURLToPath(new URL("../src/core/db-types.ts", import.meta.url)),
    "utf8",
  );
  const start = src.indexOf("    Tables: {");
  const end = src.indexOf("    Views: {", start);
  const lines = src.slice(start, end).split(/\r?\n/);
  const out = new Map<string, Set<string>>();
  let table: string | null = null;
  let inRow = false;
  for (const line of lines) {
    const t = /^ {6}(\w+): \{$/.exec(line);
    if (t) {
      table = t[1]!;
      out.set(table, new Set());
      inRow = false;
      continue;
    }
    if (/^ {8}Row: \{$/.test(line)) {
      inRow = true;
      continue;
    }
    if (inRow && /^ {8}\};$/.test(line)) {
      inRow = false;
      continue;
    }
    const c = inRow && table ? /^ {10}(\w+)\??: /.exec(line) : null;
    if (c) out.get(table!)!.add(c[1]!);
  }
  cache = out;
  return out;
}

/** Колонка из выражения PostgREST: `payload->>key` → payload, `a:b::text` → b. */
export function baseColumn(expr: string): string {
  let s = expr.trim();
  const alias = /^[\w]+:(?!:)/.exec(s);
  if (alias) s = s.slice(alias[0].length);
  s = s.split("::")[0]!;
  s = s.split("->")[0]!;
  return s.trim();
}

/** Колонки списка select верхнего уровня; встроенные связи `rel(...)` и `*` пропускаются. */
export function selectColumns(cols: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of cols + ",") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      const item = cur.trim();
      cur = "";
      if (!item || item === "*" || item.includes("(")) continue;
      out.push(baseColumn(item));
      continue;
    }
    cur += ch;
  }
  return out;
}
