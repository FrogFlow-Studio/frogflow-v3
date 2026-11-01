import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/** Папка миграций v4 (схема `v4`). */
export const V4_MIGRATIONS = "migrations/v4";

/** Файлы «вперёд» по порядку номера: 001-…, 002-… */
export function v4UpFiles(dir = V4_MIGRATIONS): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();
}

/**
 * Настоящий Postgres в памяти с применёнными миграциями v4. Роли Supabase,
 * на которые миграции выдают права, создаются заранее: в PGlite их нет.
 * `upTo` — применить только файлы до этого номера включительно (тест отката).
 */
export async function v4Db(opts: { upTo?: string; dir?: string } = {}): Promise<PGlite> {
  const dir = opts.dir ?? V4_MIGRATIONS;
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    end $$;
  `);
  for (const f of v4UpFiles(dir)) {
    if (opts.upTo && f.slice(0, opts.upTo.length) > opts.upTo) break;
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}
