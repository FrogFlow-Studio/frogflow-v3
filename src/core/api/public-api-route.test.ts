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
const { createApiKey, recordApiKeyUse, loadApiKeyUse, API_KEY_USE_GAP_MS } =
  await import("./public-api");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

function call(path: string, token: string | null, init: RequestInit = {}) {
  const request = new Request(`https://app.test/api/v1/${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as object),
    },
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
  db.tables.bot_users = [
    ...[3, 1, 2, 5, 4].map((n) => ({
      bot_id: BOT,
      user_key: `tg:${n}`,
      first_name: `Имя${n}`,
      last_name: n === 1 ? "Фамилия" : null,
      username: `u${n}`,
      contact_phone: `+7700000000${n}`,
      email: n === 2 ? "a@b.kz" : null,
      loyalty_points: n * 100,
      platform: "telegram",
      state: { mode: "secret-state" },
      metadata: { token: "secret-meta" },
      zernio_conversation_id: "conv-secret",
      created_at: "2026-09-01T00:00:00Z",
      // у всех пятерых одно время изменения: порядок страниц держится только на ключе
      updated_at: n === 5 ? "2026-08-01T00:00:00Z" : "2026-09-10T00:00:00Z",
    })),
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

  it("покупатели: только чтение, нужные поля, без состояния бота и служебного", async () => {
    const r = await call("customers", token);
    expect(r.status).toBe(200);
    const { customers } = (await r.json()) as { customers: Array<Record<string, unknown>> };
    expect(customers.map((c) => c.id)).toEqual(["tg:1", "tg:2", "tg:3", "tg:4", "tg:5"]);
    expect(customers[0]).toEqual({
      id: "tg:1",
      name: "Имя1 Фамилия",
      username: "u1",
      phone: "+77000000001",
      email: null,
      points: 100,
      channel: "telegram",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    });
    expect(JSON.stringify(customers)).not.toMatch(/secret/);
    for (const method of ["PATCH"])
      expect((await call("customers", token, { method })).status).toBe(404);
    expect(db.tables.bot_users).toHaveLength(5);
  });

  it("покупатели: страницы по ключу без потерь и повторов, updated_since, плохие параметры", async () => {
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r = (await (
        await call(`customers?limit=2${after ? `&after=${after}` : ""}`, token)
      ).json()) as {
        customers: Array<{ id: string }>;
        next_after: string | null;
      };
      seen.push(...r.customers.map((c) => c.id));
      after = r.next_after;
      if (!after) break;
    }
    expect(seen).toEqual(["tg:1", "tg:2", "tg:3", "tg:4", "tg:5"]);
    const fresh = (await (
      await call("customers?updated_since=2026-09-01T00:00:00Z", token)
    ).json()) as {
      customers: Array<{ id: string }>;
    };
    expect(fresh.customers.map((c) => c.id)).toEqual(["tg:1", "tg:2", "tg:3", "tg:4"]);
    for (const q of ["limit=0", "limit=101", "updated_since=вчера", "limit=x"])
      expect((await call(`customers?${q}`, token)).status, q).toBe(400);
  });

  it("покупатели: без ключа 401, магазин прежней платформы 404, чужой магазин не виден", async () => {
    expect((await call("customers", null)).status).toBe(401);
    tenantSettings = { served_by: "v1" };
    expect((await call("customers", token)).status).toBe(404);
    tenantSettings = { served_by: "v2" };
    db.tables.bot_users!.push({ bot_id: "other", user_key: "tg:999", loyalty_points: 1 });
    const ids = (
      (await (await call("customers", token)).json()) as { customers: Array<{ id: string }> }
    ).customers.map((c) => c.id);
    expect(ids).not.toContain("tg:999");
  });

  it("последнее использование ключа: адрес и программа, не чаще раза в минуту", async () => {
    expect(await loadApiKeyUse(ctx())).toBeNull();
    await call("orders", token, {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "1C-Connector/8.3" },
    });
    const first = await loadApiKeyUse(ctx());
    expect(first).toMatchObject({ ip: "203.0.113.7", agent: "1C-Connector/8.3" });
    // Запрос в ту же минуту отметку не переписывает.
    await call("orders", token, { headers: { "x-forwarded-for": "198.51.100.9" } });
    expect(await loadApiKeyUse(ctx())).toEqual(first);
    // Через минуту — переписывает.
    const later = new Date(Date.parse(first!.at) + API_KEY_USE_GAP_MS + 1);
    expect(await recordApiKeyUse(ctx(), { ip: "198.51.100.9", agent: null }, later)).toBe(true);
    expect((await loadApiKeyUse(ctx()))!.ip).toBe("198.51.100.9");
  });

  it("последнее использование: запрос без верного ключа его не отмечает; гонка — одна запись; новый ключ обнуляет", async () => {
    await call("orders", `ffk_${BOT}_${"y".repeat(43)}`);
    expect(await loadApiKeyUse(ctx())).toBeNull();
    const now = new Date("2026-10-04T12:00:00Z");
    const wrote = await Promise.all(
      Array.from({ length: 10 }, () => recordApiKeyUse(ctx(), { ip: "1.1.1.1", agent: null }, now)),
    );
    expect(wrote.filter(Boolean)).toHaveLength(1);
    await createApiKey(ctx());
    expect(await loadApiKeyUse(ctx())).toBeNull();
  });
});
