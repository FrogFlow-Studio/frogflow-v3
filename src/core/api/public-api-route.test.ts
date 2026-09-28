import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

// Маршрут /api/v1/*: ключ, видимость магазина, чтение и правка остатков.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
let tenantSettings: Record<string, unknown> = { served_by: "v2" };
let modules: Record<string, boolean> = { public_api: true };
const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
const ctx = () =>
  ({
    tenant: { id: BOT, modules, settings: tenantSettings, archived: false },
    db,
  }) as unknown as TenantContext;

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async ({ value }: { value: string }) =>
    value === BOT ? { id: BOT, modules, settings: tenantSettings, archived: false } : null,
  tenantContext: () => ctx(),
}));
vi.mock("@/core/storefront/rate-limit", () => ({ takeShared: async () => true }));

const { Route } = await import("@/routes/api/v1.$");
const { createApiKey } = await import("./public-api");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

function call(path: string, token: string | null, init: RequestInit = {}) {
  const request = new Request(`https://app.test/api/v1/${path}`, {
    ...init,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return handlers[(init.method ?? "GET") as string]!({
    request,
    params: { _splat: path.split("?")[0]! },
  });
}

let token = "";
beforeEach(async () => {
  tenantSettings = { served_by: "v2" };
  modules = { public_api: true };
  db.tables.app_settings = [];
  db.tables.orders = [
    {
      id: 1,
      bot_id: BOT,
      order_no: 1,
      display_no: 1,
      status: "paid",
      total: 1000,
      currency: "KZT",
      platform: "telegram",
      telegram_id: 5,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: 2,
      bot_id: BOT,
      order_no: 2,
      display_no: 2,
      status: "delivered",
      total: 2000,
      currency: "KZT",
      platform: "web",
      telegram_id: -7,
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
  ];
  db.tables.order_items = [];
  db.tables.products = [
    {
      id: "0b3a6f1e-9a55-4c1a-8e0f-2d1f5c6b7a88",
      bot_id: BOT,
      name: "Коробка",
      price: 5000,
      currency: "KZT",
      is_active: true,
      stock_quantity: 0,
      fulfillment_kind: "physical",
      category_id: null,
      sort_order: 1,
      description: "",
    },
  ];
  token = (await createApiKey(ctx())).token;
});

describe("/api/v1", () => {
  it("без ключа, с чужим или отозванным ключом — 401", async () => {
    expect((await call("orders", null)).status).toBe(401);
    expect((await call("orders", `ffk_${BOT}_${"y".repeat(43)}`)).status).toBe(401);
    await createApiKey(ctx()); // новый ключ — прежний больше не действует
    expect((await call("orders", token)).status).toBe(401);
  });

  it("магазин прежней платформы и без модуля — 404 даже с верным ключом", async () => {
    tenantSettings = { served_by: "v1" };
    expect((await call("orders", token)).status).toBe(404);
    tenantSettings = { served_by: "v2" };
    modules = {};
    expect((await call("orders", token)).status).toBe(404);
  });

  it("список заказов — новые сверху, фильтр по статусу, курсор", async () => {
    const all = (await (await call("orders", token)).json()) as { orders: Array<{ id: number }> };
    expect(all.orders.map((o) => o.id)).toEqual([2, 1]);
    const paid = (await (await call("orders?status=paid", token)).json()) as {
      orders: Array<{ id: number }>;
    };
    expect(paid.orders.map((o) => o.id)).toEqual([1]);
    const page = (await (await call("orders?limit=1", token)).json()) as {
      next_before_id: number;
    };
    expect(page.next_before_id).toBe(2);
    expect((await call("orders?limit=500", token)).status).toBe(400);
    const one = (await (await call("orders/2", token)).json()) as { order: { number: number } };
    expect(one.order.number).toBe(2);
    expect((await call("orders/99", token)).status).toBe(404);
  });

  it("товары: список и правка остатка, цены, активности с проверкой значений", async () => {
    const list = (await (await call("products", token)).json()) as {
      products: Array<{ stock: number }>;
    };
    expect(list.products).toHaveLength(1);
    const id = "0b3a6f1e-9a55-4c1a-8e0f-2d1f5c6b7a88";
    const r = await call(`products/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ stock: 7, price: 4500.5, active: false }),
    });
    expect(r.status).toBe(200);
    expect(db.tables.products![0]).toMatchObject({
      stock_quantity: 7,
      price: 4500.5,
      is_active: false,
    });
    const bad = await call(`products/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ stock: -1 }),
    });
    expect(bad.status).toBe(400);
    const empty = await call(`products/${id}`, token, { method: "PATCH", body: "{}" });
    expect(empty.status).toBe(400);
  });
});
