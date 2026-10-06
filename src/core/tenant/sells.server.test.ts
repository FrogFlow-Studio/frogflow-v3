import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sellsNow, sellsNowOrShop } from "./sells.server";

function ctx(vertical: string, modules: Record<string, boolean>, products: number) {
  const db = fakeDb();
  db.tables.products = Array.from({ length: products }, (_, i) => ({
    id: `p${i}`,
    bot_id: "b",
    is_active: true,
  }));
  return { tenant: { id: "b", vertical, modules, settings: {} }, db } as unknown as TenantContext;
}

describe("продаёт ли клиент сейчас", () => {
  it("BOVI: консультант с модулем магазина из v1, товаров нет — не продаёт", async () => {
    expect(await sellsNow(ctx("consultant", { shop: true, dm_shop: true }, 0))).toBe(false);
    expect(await sellsNow(ctx("consultant", { shop: true }, 3))).toBe(true);
    expect(await sellsNow(ctx("consultant", { instagram: true }, 3))).toBe(false);
    expect(await sellsNow(ctx("digital", {}, 0))).toBe(true);
  });

  it("сбой чтения: строгая версия — ошибка, версия для бота — магазин как раньше", async () => {
    const c = ctx("consultant", { dm_shop: true }, 0);
    const down = { data: null, count: null, error: { message: "connection reset" } };
    (c.db as unknown as { from: unknown }).from = () => ({
      select: () => ({ eq: async () => down }),
    });
    await expect(sellsNow(c)).rejects.toThrow();
    expect(await sellsNowOrShop(c)).toBe(true);
  });
});
