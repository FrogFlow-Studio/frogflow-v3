import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ordersStamp, shouldRefresh, stampKey } from "./live";

const ctx = (db: ReturnType<typeof fakeDb>) => ({ db }) as unknown as TenantContext;

describe("живое обновление заказов", () => {
  it("отпечаток: последнее изменение и число заказов; пустой магазин — null и 0", async () => {
    const db = fakeDb();
    db.tables.orders = [];
    expect(await ordersStamp(ctx(db))).toEqual({ latest: null, count: 0 });
    db.tables.orders = [
      { id: 1, updated_at: "2026-09-28T10:00:00.000Z" },
      { id: 2, updated_at: "2026-09-28T11:00:00.000Z" },
    ];
    expect(await ordersStamp(ctx(db))).toEqual({ latest: "2026-09-28T11:00:00.000Z", count: 2 });
  });

  it("новый заказ, смена статуса и удаление меняют ключ", () => {
    const base = stampKey({ latest: "2026-09-28T11:00:00.000Z", count: 2 });
    expect(stampKey({ latest: "2026-09-28T11:00:05.000Z", count: 3 })).not.toBe(base);
    expect(stampKey({ latest: "2026-09-28T11:00:05.000Z", count: 2 })).not.toBe(base);
    expect(stampKey({ latest: "2026-09-28T11:00:00.000Z", count: 1 })).not.toBe(base);
  });

  it("первый ответ не перечитывает страницу, тот же ключ — тоже", () => {
    expect(shouldRefresh(null, "2:x")).toBe(false);
    expect(shouldRefresh("2:x", "2:x")).toBe(false);
    expect(shouldRefresh("2:x", "3:y")).toBe(true);
  });
});
