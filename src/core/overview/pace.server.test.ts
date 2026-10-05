import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { loadSalesPace } from "./pace.server";

const NOW = new Date("2026-10-05T10:30:00Z");
const ctxOf = (db: unknown) => ({ db, timezone: "Asia/Almaty" }) as unknown as TenantContext;

describe("«Сегодня»: чтение продаж", () => {
  it("1 000+ заказов за двое суток при потолке ответа 1000: считаются все", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.orders = Array.from({ length: 1300 }, (_, i) => ({
      id: i + 1,
      created_at: "2026-10-05T04:00:00Z",
      total: 100,
      paid_amount: 100,
      currency: "KZT",
      status: "delivered",
      fulfillment_kind: null,
    }));
    const p = await loadSalesPace(ctxOf(db), NOW);
    expect(p.orders).toBe(1300);
    expect(p.today).toBe(130_000);
  });

  it("старше окна и в других статусах — не читаются", async () => {
    const db = fakeDb();
    db.tables.orders = [
      { id: 1, created_at: "2026-10-01T04:00:00Z", total: 5, status: "delivered", currency: "KZT" },
      { id: 2, created_at: "2026-10-05T04:00:00Z", total: 5, status: "rejected", currency: "KZT" },
    ];
    expect((await loadSalesPace(ctxOf(db), NOW)).today).toBe(0);
  });

  it("не удалось прочитать — сбой, а не «пока нет продаж»", async () => {
    const db = withBrokenReads(fakeDb(), ["orders"]);
    await expect(loadSalesPace(ctxOf(db), NOW)).rejects.toThrow();
  });
});
