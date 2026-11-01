import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { type V4Db, v4Error } from "../core/db";

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
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'tenant_bot') then create role tenant_bot; end if;
    end $$;
  `);
  for (const f of v4UpFiles(dir)) {
    if (opts.upTo && f.slice(0, opts.upTo.length) > opts.upTo) break;
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

/**
 * Ядро v4 поверх PGlite. С `botId` каждый вызов идёт под ролью арендатора
 * tenant_bot с bot_id в claims, как PostgREST с ключом арендатора: RLS
 * проверяется по-настоящему. Без `botId` — как сервисная роль (суперпользователь).
 */
export function pgliteV4(db: PGlite, opts: { botId?: string } = {}): V4Db {
  return {
    async call(fn, args) {
      const names = Object.keys(args);
      const sql = `select * from v4.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      const values = names.map((n) => args[n]);
      try {
        if (!opts.botId) return (await db.query<Record<string, unknown>>(sql, values)).rows;
        const botId = opts.botId;
        return await db.transaction(async (tx) => {
          await tx.query("set local role tenant_bot");
          await tx.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ role: "tenant_bot", bot_id: botId }),
          ]);
          return (await tx.query<Record<string, unknown>>(sql, values)).rows;
        });
      } catch (e) {
        throw v4Error(fn, e instanceof Error ? e.message : String(e));
      }
    },
  };
}
