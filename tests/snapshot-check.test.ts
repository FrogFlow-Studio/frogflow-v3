import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  TABLES,
  compareSnapshots,
  parseEnvFile,
  report,
  type Snapshot,
} from "../scripts/snapshot-check.ts";

const snap = (
  over: Partial<Snapshot> = {},
  patch: Record<string, number | null> = {},
): Snapshot => ({
  takenAt: "2026-10-03T00:00:00Z",
  host: "copy.supabase.co",
  counts: { ...Object.fromEntries(TABLES.map((t) => [t, 10])), ...patch },
  lastOrderAt: "2026-10-02T10:00:00Z",
  buckets: [...BUCKETS],
  ...over,
});

describe("сверка копии базы", () => {
  it("разбирает файл env: кавычки, комментарии, пробелы", () => {
    expect(
      parseEnvFile(
        '# комментарий\nSUPABASE_URL = "https://x.supabase.co"\nSUPABASE_SERVICE_ROLE_KEY=abc\n',
      ),
    ).toEqual({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "abc" });
  });

  it("копия, совпавшая с боевой, годится", () => {
    const cmp = compareSnapshots(snap(), snap({ host: "prod.supabase.co" }));
    expect(cmp).toMatchObject({ ok: true, missing: [], extra: [], behind: [], missingBuckets: [] });
  });

  it("копия старше боевой — это норма, но видна в отчёте", () => {
    const copy = snap({}, { orders: 8 });
    const ref = snap({ host: "prod.supabase.co" });
    const cmp = compareSnapshots(copy, ref);
    expect(cmp.ok).toBe(true);
    expect(cmp.behind).toEqual([{ table: "orders", copy: 8, ref: 10 }]);
    expect(report(copy, ref, cmp)).toContain("orders: в копии 8, в боевой 10 (копия старше на 2)");
  });

  it("строк больше, чем в боевой, нет таблицы или бакета — копия не годится", () => {
    const ref = snap({ host: "prod.supabase.co" });
    expect(compareSnapshots(snap({}, { bots: 11 }), ref).ok).toBe(false);
    expect(compareSnapshots(snap({}, { bot_users: null }), ref)).toMatchObject({
      ok: false,
      missing: ["bot_users"],
    });
    const noBucket = compareSnapshots(
      snap({ buckets: BUCKETS.filter((b) => b !== "payment-proofs") }),
      ref,
    );
    expect(noBucket).toMatchObject({ ok: false, missingBuckets: ["payment-proofs"] });
    expect(report(snap(), ref, noBucket)).toContain("копия НЕ годится");
  });

  it("без боевого файла проверяются только таблицы и бакеты", () => {
    expect(compareSnapshots(snap({}, { orders: 0 }), null).ok).toBe(true);
  });

  it("каждая таблица из списка есть в карте docs/db-schema.md", async () => {
    const { readFileSync } = await import("node:fs");
    const map = readFileSync("docs/db-schema.md", "utf8").split("## 1. Таблицы по доменам")[0]!;
    for (const t of TABLES) expect(map).toContain(`\`${t}\``);
  });
});
