import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  VTB_LAST_ERROR_KEY,
  VTB_RATE_KEY,
  getFreshRate,
  getStoredRateStrict,
  loadAttemptLog,
  refreshRate,
} from "./rate.server";
import { adminT } from "@/app/i18n/admin";
import { rateAttemptText } from "@/app/admin/pricelist-cards";

vi.mock("@/config/env", () => ({ env: () => ({}) }));

// Страница банка на finkaz: курс покупки рубля 4,45, продажи 4,95.
const PAGE = `
  <h1>Курсы валют Kaspi Bank</h1>
  <p>Курсы обновлены: 22.09.2026 09:12</p>
  <table>
    <tr><th>Валюта</th><th>Покупка</th><th>Продажа</th></tr>
    <tr><td>USD / KZT</td><td>538.50</td><td>545.10</td></tr>
    <tr><td>RUB / KZT</td><td>4.45</td><td>4.95</td></tr>
  </table>`;
const NOW = Date.parse("2026-09-22T06:00:00Z");

let n = 0;
function shop(rateRow?: string, source: "vtb" | "finkaz" | "manual" = "finkaz") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = rateRow ? [{ bot_id: "b", key: VTB_RATE_KEY, value: rateRow }] : [];
  const ctx = {
    tenant: {
      id: `bot-${++n}`,
      modules: {},
      settings: { consultant_pricelist: { enabled: true, rate_source: source } },
    },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

const page = vi.fn(async () => new Response(PAGE));

describe("курс рубля магазина", () => {
  it("обновляется со страницы банка и годится для цены", async () => {
    const { ctx, db } = shop();
    const r = await refreshRate(ctx, page as unknown as typeof fetch, NOW);
    expect(r).toMatchObject({ ok: true, fetched: true, kind: "finkaz" });
    expect(r.stored).toMatchObject({ rate: 4.45, sell: 4.95 });
    expect((await getFreshRate(ctx, NOW))?.rate).toBe(4.45);
    const log = JSON.parse(
      String(db.tables.app_settings!.find((x) => x.key === VTB_LAST_ERROR_KEY)!.value),
    );
    expect(log.ok).toBe(true);
  });

  it("скачок больше 15% к недавнему курсу не принимается — остаётся прежний", async () => {
    const prev = JSON.stringify({ rate: 6, updatedAt: new Date(NOW - 3600_000).toISOString() });
    const { ctx } = shop(prev);
    const r = await refreshRate(ctx, page as unknown as typeof fetch, NOW);
    expect(r).toMatchObject({ ok: true, fetched: false, error: "rate_jump_rejected" });
    expect(r.stored?.rate).toBe(6);
  });

  it("источник недоступен — прежний курс остаётся; трёхдневный в цену не идёт", async () => {
    const old = JSON.stringify({
      rate: 4.4,
      updatedAt: new Date(NOW - 80 * 3600_000).toISOString(),
    });
    const { ctx } = shop(old);
    const down = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const r = await refreshRate(ctx, down as unknown as typeof fetch, NOW);
    expect(r.error).toBe("fetch_failed_kept_last");
    expect(await getFreshRate(ctx, NOW)).toBeNull();
  });

  it("курс вручную — крон его не трогает", async () => {
    const { ctx } = shop(
      JSON.stringify({ rate: 4.5, updatedAt: new Date(NOW).toISOString(), source: "manual" }),
      "manual",
    );
    const r = await refreshRate(ctx, page as unknown as typeof fetch, NOW);
    expect(r.error).toBe("manual");
    expect(r.stored?.rate).toBe(4.5);
  });

  it("журнал попытки — коды для панели: продавец читает его на своём языке", async () => {
    const { ctx } = shop(
      JSON.stringify({ rate: 6, updatedAt: new Date(NOW - 3600_000).toISOString() }),
    );
    await refreshRate(ctx, page as unknown as typeof fetch, NOW);
    const log = await loadAttemptLog(ctx);
    // Строки для оператора и v1 — по-русски, как раньше.
    expect(log?.attempts.at(-1)).toMatch(/не приняли, оставили прежний/);
    expect(log?.entries?.map((e) => e.code)).toEqual(["ok", "jumpRejected"]);
    const en = log!.entries!.map((e) => rateAttemptText(adminT("en"), e));
    expect(en[0]).toBe("Kaspi (finkaz.kz): OK, buy 4.45, sell 4.95");
    expect(en[1]).toBe(
      "rate 4.45 differs from the previous 6 by 26% — not accepted, kept the previous one",
    );
    const kk = rateAttemptText(adminT("kk"), log!.entries![1]!);
    expect(kk).toMatch(/қабылданбады/);
  });

  it("журнал без кодов (старый или от v1) читается строками", async () => {
    const { ctx, db } = shop();
    db.tables.app_settings!.push({
      bot_id: "b",
      key: VTB_LAST_ERROR_KEY,
      value: JSON.stringify({ at: "2026-09-22T06:00:00Z", ok: false, attempts: ["ВТБ: таймаут"] }),
    });
    const log = await loadAttemptLog(ctx);
    expect(log).toMatchObject({ attempts: ["ВТБ: таймаут"] });
    expect(log?.entries).toBeUndefined();
  });

  it("«Обзор»: сбой чтения курса — ошибка, а не «курса нет»", async () => {
    const { ctx } = shop();
    const broken = {
      ...ctx,
      tenant: { ...ctx.tenant, id: "bot-broken" },
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
          }),
        }),
      },
    } as unknown as TenantContext;
    await expect(getStoredRateStrict(broken, NOW)).rejects.toThrow();
  });
});
