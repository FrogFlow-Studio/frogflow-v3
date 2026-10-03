import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { referralReport, referralReportCsv } from "./report";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-03T12:00:00Z");

function ctxOf(db: FakeDb) {
  return { tenant: { id: BOT, modules: { referral: true } }, db } as unknown as TenantContext;
}

function ref(id: string, referrer: number, over: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: BOT,
    referrer_telegram_id: referrer,
    referred_telegram_id: Number(id.replace(/\D/g, "")) + 1000,
    status: "pending",
    reward_promo_code: null,
    created_at: "2026-10-01T00:00:00Z",
    rewarded_at: null,
    ...over,
  };
}

describe("отчёт «Рефералы»", () => {
  it("кто пригласил, сколько пришло и купило, коды с отметкой использования, итоги за 30 дней", async () => {
    const db = fakeDb();
    db.tables.bot_users = [
      { telegram_id: 7, first_name: "Аня", last_name: "К", username: "anya" },
      { telegram_id: 8, first_name: null, last_name: null, username: "bob" },
    ];
    db.tables.referrals = [
      ref("r1", 7, {
        status: "rewarded",
        reward_promo_code: "REF-A",
        created_at: "2026-08-01T00:00:00Z",
        rewarded_at: "2026-08-05T00:00:00Z",
      }),
      ref("r2", 7, {
        status: "rewarded",
        reward_promo_code: "REF-B",
        rewarded_at: "2026-10-02T00:00:00Z",
      }),
      ref("r3", 7),
      ref("r4", 8),
    ];
    db.tables.promo_codes = [
      { code: "REF-A", used_count: 1, max_uses: 1 },
      { code: "REF-B", used_count: 0, max_uses: 1 },
    ];
    const r = await referralReport(ctxOf(db), NOW);
    expect(r.total).toEqual({ came: 4, bought: 2 });
    expect(r.last30).toEqual({ came: 3, bought: 1 });
    expect(r.rows.map((x) => [x.referrerId, x.name, x.came, x.bought])).toEqual([
      [7, "Аня К", 3, 2],
      [8, "@bob", 1, 0],
    ]);
    expect(r.rows[0]!.codes).toEqual([
      { code: "REF-A", used: true },
      { code: "REF-B", used: false },
    ]);
  });

  it("больше 1000 приглашений и 200 пригласивших читаются целиком, порядок устойчив", async () => {
    const db = fakeDb();
    db.tables.referrals = Array.from({ length: 1250 }, (_, i) =>
      ref(`r${String(i).padStart(5, "0")}`, 1 + (i % 250), {
        status: i % 5 === 0 ? "rewarded" : "pending",
      }),
    );
    const r = await referralReport(ctxOf(db), NOW);
    expect(r.total).toEqual({ came: 1250, bought: 250 });
    expect(r.rows).toHaveLength(250);
    expect(r.rows.every((x) => x.came === 5)).toBe(true);
    // Порядок: пришло ↓, купили ↓, затем id — одинаков при каждом чтении.
    const ids = r.rows.map((x) => x.referrerId);
    expect(new Set(ids).size).toBe(250);
    expect(ids).toEqual(
      [...r.rows]
        .sort((a, b) => b.came - a.came || b.bought - a.bought || a.referrerId - b.referrerId)
        .map((x) => x.referrerId),
    );
  });

  it("сбой чтения — отказ, а не пустой отчёт", async () => {
    const db = fakeDb();
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    const bad = new Proxy(db, {
      get: (t, prop, rcv) =>
        prop === "from"
          ? (n: string) => (n === "referrals" ? broken : t.from(n))
          : Reflect.get(t, prop, rcv),
    });
    await expect(referralReport(ctxOf(bad as FakeDb), NOW)).rejects.toThrow(/referral/);
  });

  it("CSV: BOM, «;», кавычки и коды с отметкой", async () => {
    const db = fakeDb();
    db.tables.bot_users = [
      { telegram_id: 7, first_name: "=Аня;", last_name: null, username: null },
    ];
    db.tables.referrals = [ref("r1", 7, { status: "rewarded", reward_promo_code: "REF-A" })];
    db.tables.promo_codes = [{ code: "REF-A", used_count: 1, max_uses: 1 }];
    const { csv, count } = await referralReportCsv(ctxOf(db), NOW);
    expect(count).toBe(1);
    expect(csv.startsWith("﻿Пригласил;Telegram ID;Пришло;Купили;Выданные коды")).toBe(true);
    expect(csv).toContain(`"'=Аня;";7;1;1;REF-A (использован)`);
  });
});
