import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import {
  aiHold,
  aiRelease,
  aiSettle,
  markupBp,
  type MarkupSource,
  newMarkupState,
  v4MarkupSource,
  withMarkup,
} from "./wallet";

/**
 * ИИ-кошелёк (018) на настоящем Postgres: бронь, расчёт с наценкой, возврат,
 * гонки, дневной предел, перенос из v3 и обратно, права арендатора.
 * Сценарии экзамена D01–D11 по деньгам — здесь на уровне базы.
 */
const A = "aaaaaaaa-0000-4000-8000-0000000002a1";
const B = "bbbbbbbb-0000-4000-8000-0000000002b2";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
const service = () => pgliteV4(pg);

const balance = async (bot = A) =>
  Number(
    (
      await pg.query<{ b: string }>(
        "select coalesce((select balance_micro_usd from v4.ai_wallet where bot_id = $1), 0) b",
        [bot],
      )
    ).rows[0]!.b,
  );
const drift = async (bot = A) =>
  Number((await pg.query<{ d: string }>("select v4.ai_wallet_drift($1) d", [bot])).rows[0]!.d);
const credit = (bot: string, micro: number, kind = "topup") =>
  pg.query("select v4.ai_credit($1, $2, $3, 'тест', 'operator')", [bot, kind, micro]);
const openCases = async (bot: string, kind: string) =>
  Number(
    (
      await pg.query<{ n: number }>(
        "select count(*)::int n from v4.cases where bot_id = $1 and kind = $2 and status = 'open'",
        [bot, kind],
      )
    ).rows[0]!.n,
  );

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B])
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
});
afterAll(() => pg.close());

describe("бронь и расчёт", () => {
  it("D11: api 12 000 + наценка 25 % = 15 000 микродолларов, в книге процент", async () => {
    await credit(A, 1_000_000);
    const h = await aiHold(asA(), { botId: A, purpose: "seller", mode: "live" });
    expect(h.ok).toBe(true);
    expect(await balance()).toBe(1_000_000 - 60_000);
    const total = await aiSettle(asA(), {
      botId: A,
      holdId: (h as { holdId: number }).holdId,
      apiMicroUsd: 12_000,
      markupBp: 2500,
    });
    expect(total).toBe(15_000);
    expect(withMarkup(12_000, 2500)).toBe(15_000);
    expect(await balance()).toBe(1_000_000 - 15_000);
    const row = await pg.query<Record<string, string>>(
      "select api_micro_usd, markup_bp, total_micro_usd from v4.ai_ledger where bot_id = $1 and kind = 'settle'",
      [A],
    );
    expect(row.rows.map((r) => Object.values(r).map(Number))).toEqual([[12000, 2500, 15000]]);
    expect(await drift()).toBe(0);
  });

  it("наценка округляется вверх до микродоллара", () => {
    expect(withMarkup(1, 2500)).toBe(2);
    expect(withMarkup(3, 1000)).toBe(4);
    expect(withMarkup(0, 2500)).toBe(0);
  });

  it("бронь закрывается один раз: повторный расчёт и возврат — отказ, остаток не меняется", async () => {
    const h = (await aiHold(asA(), { botId: A, purpose: "seller", mode: "live" })) as {
      holdId: number;
    };
    await aiSettle(asA(), { botId: A, holdId: h.holdId, apiMicroUsd: 1000, markupBp: 2500 });
    const before = await balance();
    await expect(
      aiSettle(asA(), { botId: A, holdId: h.holdId, apiMicroUsd: 1000, markupBp: 2500 }),
    ).rejects.toThrow(/append_only/);
    await expect(aiRelease(asA(), { botId: A, holdId: h.holdId })).rejects.toThrow(/append_only/);
    expect(await balance()).toBe(before);
    expect(await drift()).toBe(0);
  });

  it("два расчёта одной брони одновременно — списано один раз", async () => {
    const h = (await aiHold(asA(), { botId: A, purpose: "seller", mode: "live" })) as {
      holdId: number;
    };
    const before = await balance();
    const r = await Promise.allSettled([
      aiSettle(asA(), { botId: A, holdId: h.holdId, apiMicroUsd: 2000, markupBp: 2500 }),
      aiSettle(asA(), { botId: A, holdId: h.holdId, apiMicroUsd: 2000, markupBp: 2500 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await balance()).toBe(before + 60_000 - 2500);
  });

  it("модель не ответила — возврат брони целиком", async () => {
    const before = await balance();
    const h = (await aiHold(asA(), { botId: A, purpose: "seller", mode: "live" })) as {
      holdId: number;
    };
    await aiRelease(asA(), { botId: A, holdId: h.holdId });
    expect(await balance()).toBe(before);
  });

  it("висящая бронь через 5 минут возвращается тиком один раз", async () => {
    const before = await balance();
    const t = new Date("2026-11-27T10:00:00Z");
    await aiHold(asA(), { botId: A, purpose: "seller", mode: "live", now: t });
    expect(await balance()).toBe(before - 60_000);
    const later = new Date(t.getTime() + 5 * 60_000 + 1);
    const [n1] = (
      await pg.query<{ n: number }>("select v4.ai_expire_holds($1) n", [later.toISOString()])
    ).rows.map((r) => r.n);
    const [n2] = (
      await pg.query<{ n: number }>("select v4.ai_expire_holds($1) n", [later.toISOString()])
    ).rows.map((r) => r.n);
    expect(n1).toBe(1);
    expect(n2).toBe(0);
    expect(await balance()).toBe(before);
    expect(await drift()).toBe(0);
  });
});

describe("пусто, предел дня, гонка за последние деньги", () => {
  it("пустой кошелёк — отказ wallet_empty и одно дело продавцу в сутки", async () => {
    const r1 = await aiHold(asB(), { botId: B, purpose: "seller", mode: "live" });
    const r2 = await aiHold(asB(), { botId: B, purpose: "seller", mode: "live" });
    expect(r1).toEqual({ ok: false, reason: "wallet_empty" });
    expect(r2).toEqual({ ok: false, reason: "wallet_empty" });
    expect(await openCases(B, "ai_limit")).toBe(1);
    expect(await balance(B)).toBe(0);
  });

  it("денег на одну бронь: из двух одновременных проходит одна", async () => {
    await credit(B, 60_000);
    const r = await Promise.all([
      aiHold(asB(), { botId: B, purpose: "seller", mode: "live" }),
      aiHold(asB(), { botId: B, purpose: "seller", mode: "live" }),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(await balance(B)).toBe(0);
  });

  it("дневной предел магазина: потрачено ≥ предела — limit_day, деньги не бронируются", async () => {
    await credit(B, 1_000_000);
    const day = new Date("2026-11-27T08:00:00Z");
    const h = (await aiHold(asB(), {
      botId: B,
      purpose: "seller",
      mode: "live",
      dailyCapMicroUsd: 20_000,
      now: day,
    })) as { holdId: number };
    await aiSettle(asB(), {
      botId: B,
      holdId: h.holdId,
      apiMicroUsd: 16_000,
      markupBp: 2500,
      now: day,
    });
    const before = await balance(B);
    expect(
      await aiHold(asB(), {
        botId: B,
        purpose: "seller",
        mode: "live",
        dailyCapMicroUsd: 20_000,
        now: day,
      }),
    ).toEqual({ ok: false, reason: "limit_day" });
    expect(await balance(B)).toBe(before);
    const tomorrow = new Date("2026-11-28T08:00:00Z");
    expect(
      (
        await aiHold(asB(), {
          botId: B,
          purpose: "seller",
          mode: "live",
          dailyCapMicroUsd: 20_000,
          now: tomorrow,
        })
      ).ok,
    ).toBe(true);
  });
});

describe("права арендатора", () => {
  it("чужой кошелёк не бронируется, не видно чужой книги, пополнить себе нельзя", async () => {
    await expect(aiHold(asB(), { botId: A, purpose: "seller", mode: "live" })).rejects.toThrow(
      /foreign_bot/,
    );
    const seen = await pg.transaction(async (tx) => {
      await tx.query("set local role tenant_bot");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "tenant_bot", bot_id: B }),
      ]);
      return (await tx.query("select * from v4.ai_ledger where bot_id = $1", [A])).rows;
    });
    expect(seen).toEqual([]);
    await expect(
      asA().call("ai_credit", {
        p_bot_id: A,
        p_kind: "topup",
        p_amount_micro_usd: 1,
        p_note: "x",
        p_created_by: "x",
      }),
    ).rejects.toThrow();
    await expect(
      asA().call("ai_transfer_from_v3", { p_bot_id: A, p_usd: 100, p_created_by: "x" }),
    ).rejects.toThrow();
  });
});

describe("перенос из v3 и обратно (Д9, откат)", () => {
  const C = "cccccccc-0000-4000-8000-0000000002c3";
  it("один раз на магазин, округление вниз, без стартовых 5 долл.; возврат обнуляет", async () => {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [C]);
    const t1 = await service().call("ai_transfer_from_v3", {
      p_bot_id: C,
      p_usd: 3.1234567,
      p_created_by: "migration",
    });
    const t2 = await service().call("ai_transfer_from_v3", {
      p_bot_id: C,
      p_usd: 3.1234567,
      p_created_by: "migration",
    });
    expect(t1[0]!.ai_transfer_from_v3).toEqual({ transferred: true, micro_usd: 3_123_456 });
    expect(t2[0]!.ai_transfer_from_v3).toEqual({ transferred: false, micro_usd: 3_123_456 });
    expect(await balance(C)).toBe(3_123_456);
    const starts = await pg.query(
      "select count(*)::int n from v4.ai_ledger where bot_id = $1 and kind = 'start'",
      [C],
    );
    expect(starts.rows[0]).toEqual({ n: 0 });
    // Открытая бронь при откате возвращается, остаток уходит в v3 целиком.
    await pg.query("select v4.ai_hold($1, 60000, 'seller')", [C]);
    const back = await service().call("ai_transfer_to_v3", {
      p_bot_id: C,
      p_created_by: "rollback",
    });
    expect(Number(back[0]!.ai_transfer_to_v3)).toBe(3_123_456);
    expect(await balance(C)).toBe(0);
    expect(await drift(C)).toBe(0);
  });
});

describe("наценка без сбоев (12.4)", () => {
  const src = (over: Partial<MarkupSource> & { fails?: number } = {}) => {
    let calls = 0;
    const reports: string[] = [];
    const s: MarkupSource & { reports: string[]; calls: () => number } = {
      reports,
      calls: () => calls,
      async readPercent() {
        calls++;
        if (calls <= (over.fails ?? 0)) throw new Error("db down");
        return 25;
      },
      lastLedgerBp: over.lastLedgerBp ?? (async () => null),
      async reportFailure(d) {
        reports.push(d);
      },
      sleep: async () => undefined,
    };
    return s;
  };

  it("настройка есть — 2500 б.п., кэш на минуту", async () => {
    const s = src();
    const st = newMarkupState();
    expect(await markupBp(s, st, 0)).toEqual({ bp: 2500, fallback: null });
    await markupBp(s, st, 30_000);
    expect(s.calls()).toBe(1);
    await markupBp(s, st, 61_000);
    expect(s.calls()).toBe(2);
  });

  it("база упала один раз — повтор помог, дела нет", async () => {
    const s = src({ fails: 1 });
    expect(await markupBp(s, newMarkupState(), 0)).toEqual({ bp: 2500, fallback: null });
    expect(s.reports).toEqual([]);
  });

  it("упала дважды — последнее удачное значение процесса и дело оператору", async () => {
    const st = newMarkupState();
    await markupBp(src(), st, 0);
    const s = src({ fails: 2 });
    expect(await markupBp(s, st, 120_000)).toEqual({ bp: 2500, fallback: "process" });
    expect(s.reports).toHaveLength(1);
  });

  it("после перезапуска — наценка из последней записи книги", async () => {
    const s = src({ fails: 2, lastLedgerBp: async () => 2500 });
    expect(await markupBp(s, newMarkupState(), 0)).toEqual({ bp: 2500, fallback: "ledger" });
  });

  it("ни одного удачного чтения — 0 и дело", async () => {
    const s = src({ fails: 2 });
    expect(await markupBp(s, newMarkupState(), 0)).toEqual({ bp: 0, fallback: "zero" });
    expect(s.reports).toHaveLength(1);
  });

  it("испорченная настройка (не число, отрицательная) — 0 без сбоя", async () => {
    const s = { ...src(), readPercent: async () => Number("abc") };
    expect(await markupBp(s, newMarkupState(), 0)).toEqual({ bp: 0, fallback: null });
  });

  it("источник поверх базы: последняя наценка из книги и одно дело в сутки", async () => {
    const real = v4MarkupSource(
      service(),
      async () => 25,
      A,
      () => new Date("2026-11-27T10:00:00Z"),
    );
    expect(await real.lastLedgerBp()).toBe(2500);
    await real.reportFailure("x");
    await real.reportFailure("y");
    expect(await openCases(A, "ai_markup")).toBe(1);
  });
});
