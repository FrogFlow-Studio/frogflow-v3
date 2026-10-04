import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/** «Добавили из „С этим берут“» на витрине: клиент v1, архив, без модуля — «не найден»; счётчик с потолком. */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
let tenant: Tenant;
const db = fakeDb();
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: (t: Tenant) => ({ tenant: t, db, timezone: "Asia/Almaty" }),
}));

const { storeUpsellAddedFn } = await import("./storefront.functions");
const ID = "22222222-2222-2222-2222-222222222222";
const base = {
  id: "bbbbbbbb-0000-4000-8000-0000000000aa",
  archived: false,
  modules: { shop: true, web_storefront: true, upsell: true },
  settings: { served_by: "v2", slug: "shop" },
} as unknown as Tenant;
// Покупатель сайта — счётчик дня в app_settings; журнал zernio_logs не растёт.
const counters = () =>
  (db.tables.app_settings ?? []).filter((x) => String(x.key).startsWith("engage_web:"));
const marks = () => counters().flatMap((x) => Array(Number(x.value)).fill(x.key));

describe("отметка допродажи на витрине", () => {
  it("витрина v2 с модулем — одна отметка без id покупателя", async () => {
    db.tables.zernio_logs = [];
    db.tables.app_settings = [];
    tenant = base;
    expect(await storeUpsellAddedFn({ data: { slug: "shop", productId: ID } })).toEqual({
      counted: true,
    });
    expect(counters()).toMatchObject([{ value: "1" }]);
    expect(String(counters()[0]!.key)).toMatch(/^engage_web:upsell_add:\d{4}-\d\d-\d\d$/);
    expect(db.tables.zernio_logs).toEqual([]);
  });

  it("модуль «С этим берут» выключен — не считается", async () => {
    db.tables.zernio_logs = [];
    db.tables.app_settings = [];
    tenant = { ...base, modules: { shop: true, web_storefront: true } } as unknown as Tenant;
    expect(await storeUpsellAddedFn({ data: { slug: "shop", productId: ID } })).toEqual({
      counted: false,
    });
    expect(marks()).toEqual([]);
  });

  it.each([
    ["клиент прежней платформы", { ...base, settings: { slug: "shop" } }],
    ["архив", { ...base, archived: true }],
    ["нет витрины", { ...base, modules: { shop: true, upsell: true } }],
  ])("%s — «не найден», ничего не пишется", async (_n, t) => {
    db.tables.zernio_logs = [];
    db.tables.app_settings = [];
    tenant = t as unknown as Tenant;
    await expect(
      storeUpsellAddedFn({ data: { slug: "shop", productId: ID } }),
    ).rejects.toBeTruthy();
    expect(marks()).toEqual([]);
  });

  it("не uuid товара — отказ до чтения", async () => {
    tenant = base;
    await expect(
      (async () => storeUpsellAddedFn({ data: { slug: "shop", productId: "x" } }))(),
    ).rejects.toBeTruthy();
  });

  it("за потолок в час отметки не считаются: анонимный поток не раздувает ни журнал, ни счётчик", async () => {
    db.tables.zernio_logs = [];
    db.tables.app_settings = [];
    tenant = { ...base, id: "bbbbbbbb-0000-4000-8000-0000000000ab" } as unknown as Tenant;
    const { ENGAGE_WEB_BUDGET } = await import("@/core/automsg/engage");
    let counted = 0;
    for (let i = 0; i < ENGAGE_WEB_BUDGET.limit + 5; i++)
      if ((await storeUpsellAddedFn({ data: { slug: "shop", productId: ID } })).counted) counted++;
    // Потолок приблизительный (скользящее окно): не больше лимита, и всё сверху отброшено.
    expect(counted).toBeLessThanOrEqual(ENGAGE_WEB_BUDGET.limit);
    expect(counted).toBeGreaterThan(ENGAGE_WEB_BUDGET.limit - 5);
    expect(marks()).toHaveLength(counted);
    expect(counters()).toHaveLength(1);
    expect(db.tables.zernio_logs).toEqual([]);
  });
});
