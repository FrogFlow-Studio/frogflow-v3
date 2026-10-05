import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { loadVisits, recordVisit } from "./visits.server";
import { VISIT_SOURCES_PER_DAY } from "./visits";

const BOT = "11111111-1111-1111-1111-111111111111";
const now = new Date("2026-10-05T10:00:00Z");

function setup(opts: { maxRows?: number } = {}) {
  const db = fakeDb({ ...opts, unique: { visit_sources: [["bot_id", "day", "source", "stage"]] } });
  db.tables.visit_sources = [];
  const ctx = { tenant: { id: BOT }, db, timezone: "Asia/Almaty" } as unknown as TenantContext;
  return { ctx, db };
}
const rows = (db: FakeDb) => db.tables.visit_sources as Array<Record<string, unknown>>;

describe("запись визита (У1)", () => {
  it("первый визит — строка с единицей, второй — счётчик растёт, не новая строка", async () => {
    const { ctx, db } = setup();
    expect(await recordVisit(ctx, { source: "direct", stage: "visit" }, now)).toEqual({
      counted: true,
    });
    await recordVisit(ctx, { source: "direct", stage: "visit" }, now);
    await recordVisit(ctx, { source: "direct", stage: "product" }, now);
    expect(rows(db)).toHaveLength(2);
    expect(rows(db).find((r) => r.stage === "visit")!.n).toBe(2);
    expect(rows(db).find((r) => r.stage === "product")!.n).toBe(1);
  });

  it("личных данных нет: в строке только магазин, день, источник, этап и число", async () => {
    const { ctx, db } = setup();
    await recordVisit(ctx, { source: "search", stage: "visit" }, now);
    // id — служебный ключ подставной базы; в настоящей таблице его нет (migrations/22-3)
    expect(
      Object.keys(rows(db)[0]!)
        .filter((k) => k !== "id")
        .sort(),
    ).toEqual(["bot_id", "day", "n", "source", "stage"]);
  });

  it("день — по часовому поясу магазина", async () => {
    const { ctx, db } = setup();
    // 20:00 UTC 5 октября — уже 6-е в Алматы (UTC+5)
    await recordVisit(ctx, { source: "direct", stage: "visit" }, new Date("2026-10-05T20:00:00Z"));
    expect(rows(db)[0]!.day).toBe("2026-10-06");
  });

  it("гонка: двадцать визитов одновременно — ровно двадцать в счётчике", async () => {
    const { ctx, db } = setup();
    await Promise.all(
      Array.from({ length: 20 }, () => recordVisit(ctx, { source: "direct", stage: "visit" }, now)),
    );
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]!.n).toBe(20);
  });

  it("новых источников за день не больше предела: лишние — в «other»", async () => {
    const { ctx, db } = setup();
    for (let i = 0; i < VISIT_SOURCES_PER_DAY + 5; i++)
      await recordVisit(ctx, { source: `tag:m${i}`, stage: "visit" }, now);
    const sources = new Set(rows(db).map((r) => r.source));
    expect(sources.size).toBe(VISIT_SOURCES_PER_DAY + 1);
    expect(sources.has("other")).toBe(true);
    // уже известный источник продолжает считаться под своим именем
    await recordVisit(ctx, { source: "tag:m0", stage: "visit" }, now);
    expect(rows(db).find((r) => r.source === "tag:m0")!.n).toBe(2);
  });

  it("таблицы нет — молча «не посчитано», ошибки нет", async () => {
    const { ctx } = setup();
    const missing = {
      ...ctx,
      db: {
        from: () => {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          for (const m of [
            "select",
            "eq",
            "gte",
            "lte",
            "order",
            "range",
            "insert",
            "update",
            "maybeSingle",
          ])
            q[m] = chain;
          q.then = (ok: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { code: "PGRST205", message: "could not find the table" },
            }).then(ok);
          return q;
        },
      },
    } as unknown as TenantContext;
    expect(await recordVisit(missing, { source: "direct", stage: "visit" }, now)).toEqual({
      counted: false,
    });
    expect(await loadVisits(missing, now, now)).toBeNull();
  });

  it("сбой базы — ошибка наружу, а не молчание", async () => {
    const { ctx, db } = setup();
    const broken = {
      ...ctx,
      db: withBrokenReads(db, ["visit_sources"]),
    } as unknown as TenantContext;
    await expect(recordVisit(broken, { source: "direct", stage: "visit" }, now)).rejects.toThrow();
    await expect(loadVisits(broken, now, now)).rejects.toThrow();
  });
});

describe("чтение визитов за период (У1)", () => {
  it("больше тысячи строк не обрезаются; период — по дням магазина", async () => {
    const { ctx, db } = setup({ maxRows: 1000 });
    const out: Array<Record<string, unknown>> = [];
    for (let d = 0; d < 13; d++)
      for (let s = 0; s < 100; s++)
        out.push({
          bot_id: BOT,
          day: `2026-09-${String(10 + d).padStart(2, "0")}`,
          source: `tag:s${s}`,
          stage: "visit",
          n: 1,
        });
    out.push({ bot_id: BOT, day: "2026-08-01", source: "direct", stage: "visit", n: 500 }); // вне периода
    db.tables.visit_sources = out;
    const r = await loadVisits(
      ctx,
      new Date("2026-09-10T00:00:00Z"),
      new Date("2026-09-30T00:00:00Z"),
    );
    expect(r!.total.visit).toBe(1300);
    expect(r!.bySource.direct).toBeUndefined();
  });
});
