import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { VTB_LAST_ERROR_KEY, VTB_RATE_KEY, getFreshRate, refreshRate } from "./rate.server";

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
});
