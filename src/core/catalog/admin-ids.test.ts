import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { listProductIdsForAdmin } from "./admin";

const T = "11111111-2222-3333-4444-555555555555";
const CAT = "aaaaaaaa-0000-4000-8000-000000000001";

function setup(n: number, broken = false) {
  const db = fakeDb({});
  db.tables.products = Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(5, "0")}`,
    bot_id: T,
    name: i % 3 === 0 ? `Ваза ${i}` : `Свеча ${i}`,
    is_active: i % 2 === 0,
    category_ids: i % 5 === 0 ? [CAT] : [],
  }));
  const ctx = {
    tenant: { id: T, modules: {}, settings: { served_by: "v2" } },
    db: broken ? withBrokenReads(db, ["products"]) : db,
  } as unknown as TenantContext;
  return ctx;
}

describe("«выбрать все по фильтру»", () => {
  it("возвращает все id, даже когда их больше страницы чтения (1000) и страницы списка (100)", async () => {
    const ids = await listProductIdsForAdmin(setup(2300));
    expect(ids).toHaveLength(2300);
    expect(new Set(ids).size).toBe(2300);
    expect(ids).toEqual([...ids].sort());
  });
  it("фильтры: только скрытые, категория, поиск по названию", async () => {
    const ctx = setup(2300);
    expect(await listProductIdsForAdmin(ctx, { onlyInactive: true })).toHaveLength(1150);
    expect(await listProductIdsForAdmin(ctx, { categoryId: CAT })).toHaveLength(460);
    expect(await listProductIdsForAdmin(ctx, { q: "ваза" })).toHaveLength(767);
  });
  it("сбой чтения — ошибка, а не «пустой список» (по нему ничего не применится)", async () => {
    await expect(listProductIdsForAdmin(setup(10, true))).rejects.toThrow();
  });
});
