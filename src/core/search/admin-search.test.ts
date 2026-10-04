import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { adminSearch, SEARCH_SHOWN } from "./admin-search";
import { searchSections } from "./search-sections";

const T = "11111111-2222-3333-4444-555555555555";

function setup() {
  const db = fakeDb({});
  db.tables.orders = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: 100 + i,
      bot_id: T,
      order_no: 100 + i,
      display_no: 100 + i,
      status: "delivered",
      display_name: i === 0 ? "Айгерим" : `Покупатель ${i}`,
      contact: i === 0 ? "+77011112233" : `+7700000000${i}`,
      username: null,
      customer_email: null,
      total: 1000,
      currency: "KZT",
      created_at: `2026-10-0${i + 1}T10:00:00Z`,
      order_items: [],
    })),
  ];
  db.tables.products = [
    { id: "p1", bot_id: T, name: "Ваза синяя", price: 1, is_active: true, sort_order: 0 },
  ];
  db.tables.bot_users = [
    {
      bot_id: T,
      user_key: "tg_1",
      platform: "telegram",
      telegram_id: 1,
      username: null,
      first_name: "Айгерим",
      last_name: null,
      contact_phone: "+77011112233",
      email: null,
      loyalty_points: 0,
      created_at: "2026-10-01T10:00:00Z",
    },
  ];
  db.tables.blocked_users = [];
  return {
    tenant: { id: T, modules: {}, settings: { served_by: "v2" } },
    db,
  } as unknown as TenantContext;
}

describe("быстрый поиск админки", () => {
  it("продавец: заказ по номеру, по телефону, покупатель по имени и телефону, товар", async () => {
    const ctx = setup();
    expect((await adminSearch(ctx, "103", false)).orders.map((o) => o.id)).toEqual([103]);
    // Длинная цифровая строка — телефон, а не номер заказа.
    expect((await adminSearch(ctx, "77011112233", false)).orders.map((o) => o.id)).toEqual([100]);
    const byName = await adminSearch(ctx, "Айгерим", false);
    expect(byName.customers.map((c) => c.key)).toEqual(["tg_1"]);
    expect((await adminSearch(ctx, "ваза", false)).products.map((p) => p.id)).toEqual(["p1"]);
  });

  it("бухгалтер: заказ по номеру без имени и контактов, товаров и покупателей нет", async () => {
    const ctx = setup();
    const r = await adminSearch(ctx, "100", true);
    expect(r.orders.map((o) => o.id)).toEqual([100]);
    expect(JSON.stringify(r)).not.toContain("Айгерим");
    expect(JSON.stringify(r)).not.toContain("7701");
    // Поиск по имени и товару бухгалтеру ничего не даёт.
    const byName = await adminSearch(ctx, "Айгерим", true);
    expect(byName.orders).toEqual([]);
    expect(byName.customers).toEqual([]);
    expect((await adminSearch(ctx, "ваза", true)).products).toEqual([]);
  });

  it("совпадений больше показанного: об этом сказано, а не молча обрезано", async () => {
    const ctx = setup();
    const r = await adminSearch(ctx, "Покупатель", false);
    expect(r.orders).toHaveLength(SEARCH_SHOWN);
    expect(r.ordersMore).toBe(true);
    expect((await adminSearch(ctx, "Айгерим", false)).ordersMore).toBe(false);
  });
});

describe("поиск разделов", () => {
  const menu = [{ label: "Заказы" }, { label: "Рассылки" }, { label: "Заказ-наряды" }];
  it("по названию без учёта регистра; пустой запрос — ничего", () => {
    expect(searchSections(menu, "заказ").map((i) => i.label)).toEqual(["Заказы", "Заказ-наряды"]);
    expect(searchSections(menu, "  ")).toEqual([]);
    expect(searchSections(menu, "xyz")).toEqual([]);
  });
});
