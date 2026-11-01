import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V4_MIGRATIONS, v4Db, v4UpFiles } from "./pg";

describe("миграции v4", () => {
  const files = v4UpFiles();

  it("есть хотя бы схема, номера идут подряд с 001", () => {
    expect(files[0]).toMatch(/^001-/);
    files.forEach((f, i) => expect(f.slice(0, 3)).toBe(String(i + 1).padStart(3, "0")));
  });

  it("у каждой миграции есть откат и запрос-проверка для Якова", () => {
    for (const f of files) {
      expect(existsSync(join(V4_MIGRATIONS, f.replace(/\.sql$/, ".down.sql"))), f).toBe(true);
      expect(readFileSync(join(V4_MIGRATIONS, f), "utf8"), f).toMatch(/-- Проверка/);
    }
  });

  it("миграции трогают только схему v4, не public", () => {
    for (const f of files) {
      const sql = readFileSync(join(V4_MIGRATIONS, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      expect(sql, f).not.toMatch(/\bpublic\./i);
      expect(sql, f).not.toMatch(
        /\b(alter|drop|truncate|delete\s+from|update)\s+(table\s+)?(?!v4\.)[a-z_]+\./i,
      );
    }
  });

  it("применяются на настоящем Postgres, схема v4 появляется", async () => {
    const db = await v4Db();
    const r = await db.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname = 'v4'",
    );
    expect(r.rows).toEqual([{ nspname: "v4" }]);
    await db.close();
  });

  it("откаты в обратном порядке возвращают базу без схемы v4", async () => {
    const db = await v4Db();
    for (const f of [...files].reverse())
      await db.exec(readFileSync(join(V4_MIGRATIONS, f.replace(/\.sql$/, ".down.sql")), "utf8"));
    const r = await db.query("select 1 from pg_namespace where nspname = 'v4'");
    expect(r.rows).toEqual([]);
    await db.close();
  });
});
