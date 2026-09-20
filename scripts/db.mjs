#!/usr/bin/env node
/**
 * Применить SQL-миграцию через Supabase Management API (DDL через Data API
 * невозможен). Секреты — из окружения или .env: SUPABASE_ACCESS_TOKEN
 * (Personal Access Token), SUPABASE_URL или SUPABASE_PROJECT_REF.
 *
 *   node scripts/db.mjs migrations/0001-jobs.sql
 *   node scripts/db.mjs --sql "select count(*) from v2_jobs"
 *
 * Миграции v2 — только аддитивные (новые таблицы с префиксом v2_, новые
 * функции): v1 работает на той же базе и ничего из этого не читает.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref =
  process.env.SUPABASE_PROJECT_REF ||
  process.env.SUPABASE_URL?.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!token || !ref) {
  console.error("Нужны SUPABASE_ACCESS_TOKEN и SUPABASE_URL (или SUPABASE_PROJECT_REF)");
  process.exit(1);
}
const args = process.argv.slice(2);
const sql = args[0] === "--sql" ? args[1] : readFileSync(args[0], "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(res.status, text.slice(0, 2000));
process.exit(res.ok ? 0 : 1);
