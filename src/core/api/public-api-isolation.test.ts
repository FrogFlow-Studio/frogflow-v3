import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Основа платформы П (З7): публичный API и ключ. Ключ лежит хешем и виден один раз, отзыв и
 * замена действуют со следующего запроса, лимит считается настоящим счётчиком, а чужой магазин
 * не виден ни в одном ответе — даже если база не отсекла его строки сама (роль арендатора
 * в тесте не работает, поэтому изоляцию держат фильтры самого маршрута).
 */
const A = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const B = "c52b45dc-8055-452c-9f10-614295d7c0a0";
// Настройки читаются ролью арендатора без фильтра по магазину (его делает база), поэтому у каждого
// магазина своя база настроек; заказы и товары общие: чужие строки в них фильтрует сам маршрут.
const mk = () => fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
const dbs: Record<string, ReturnType<typeof mk>> = {};
const shops: Record<string, { id: string; modules: Record<string, boolean>; settings: object }> = {
  [A]: { id: A, modules: { public_api: true }, settings: { served_by: "v2" } },
  [B]: { id: B, modules: { public_api: true }, settings: { served_by: "v2" } },
};
const ctxOf = (id: string) =>
  ({ tenant: { ...shops[id], archived: false }, db: dbs[id] }) as unknown as TenantContext;

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async ({ value }: { value: string }) =>
    shops[value] ? { ...shops[value], archived: false } : null,
  tenantContext: (t: { id: string }) => ctxOf(t.id),
}));
// Счётчик запросов — настоящий (core/storefront/rate-limit): подменять его нельзя, он и проверяется.

const { Route } = await import("@/routes/api/v1.$");
const api = await import("./public-api");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;
const call = (path: string, token: string | null, init: RequestInit = {}) =>
  handlers[init.method ?? "GET"]!({
    request: new Request(`https://app.test/api/v1/${path}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }),
    params: { _splat: path.split("?")[0]! },
  });

const PA = "0b3a6f1e-9a55-4c1a-8e0f-2d1f5c6b7a88";
const PB = "1c4b7a2f-ab66-4d2b-9f10-3e2a6d7c8b99";
let keyA = "";
let keyB = "";
beforeEach(async () => {
  dbs[A] = mk();
  dbs[B] = mk();
  for (const id of [A, B]) dbs[id]!.tables.app_settings = [];
  const order = (id: number, bot: string) => ({
    id,
    bot_id: bot,
    order_no: id,
    display_no: id,
    status: "paid",
    total: 100,
    currency: "KZT",
    platform: "web",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  });
  const orders = [order(1, A), order(2, B)];
  for (const id of [A, B]) {
    dbs[id]!.tables.orders = orders;
    dbs[id]!.tables.order_items = [];
  }
  const product = (id: string, bot: string, name: string) => ({
    id,
    bot_id: bot,
    name,
    price: 100,
    currency: "KZT",
    is_active: true,
    stock_quantity: 5,
    fulfillment_kind: "physical",
    category_id: null,
    sort_order: 1,
    description: "",
  });
  const products = [product(PA, A, "Товар А"), product(PB, B, "Чужой товар")];
  for (const id of [A, B]) dbs[id]!.tables.products = products;
  keyA = (await api.createApiKey(ctxOf(A))).token;
  keyB = (await api.createApiKey(ctxOf(B))).token;
});

describe("ключ: хеш, один показ", () => {
  it("в базе только отпечаток и 4 последних знака, самого ключа нигде нет", async () => {
    const secret = api.splitApiToken(keyA)!.secret;
    const row = dbs[A]!.tables.app_settings!.find((r) => r.key === api.API_KEY_SETTING)!;
    expect(JSON.stringify(dbs[A]!.tables.app_settings)).not.toContain(secret);
    const meta = JSON.parse(String(row.value)) as { hash: string; last4: string };
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.last4).toBe(secret.slice(-4));
    // Отпечаток другого магазина другой: секреты не повторяются.
    expect(
      JSON.parse(
        String(dbs[B]!.tables.app_settings!.find((r) => r.key === api.API_KEY_SETTING)!.value),
      ).hash,
    ).not.toBe(meta.hash);
  });

  it("узнать ключ после создания нельзя: статус отдаёт последние знаки и даты, без ключа и отпечатка", async () => {
    vi.resetModules();
    vi.doMock("@tanstack/react-start", () => ({
      createServerFn: () => {
        const b = {
          validator: () => b,
          handler: (h: (a: { data: unknown }) => unknown) => (a: { data: unknown }) =>
            h(a ?? { data: {} }),
        };
        return b;
      },
    }));
    vi.doMock("@/app/auth/guards.server", () => ({ requireAdminModule: async () => ctxOf(A) }));
    const fns = await import("@/app/admin/api-key.functions");
    const status = await (
      fns.apiKeyStatusFn as unknown as () => Promise<Record<string, unknown>>
    )();
    vi.doUnmock("@tanstack/react-start");
    vi.doUnmock("@/app/auth/guards.server");
    const text = JSON.stringify(status);
    expect(status).toMatchObject({ exists: true });
    expect(text).not.toContain(api.splitApiToken(keyA)!.secret);
    expect(text).not.toMatch(/hash|ffk_/);
  });
});

describe("чужой, отозванный и заменённый ключ", () => {
  it("ключ магазина А не открывает магазин Б: ни со своим секретом, ни с подставленным номером", async () => {
    const secretA = api.splitApiToken(keyA)!.secret;
    expect((await call("orders", `ffk_${B}_${secretA}`)).status).toBe(401);
    expect((await call("products", `ffk_${A}_${"x".repeat(43)}`)).status).toBe(401);
    // Магазина с таким номером нет — ответ тот же, что у несуществующей функции, без подробностей.
    const ghost = await call(
      "orders",
      `ffk_${"9".repeat(8)}-9999-4999-8999-${"9".repeat(12)}_${secretA}`,
    );
    expect([401, 404]).toContain(ghost.status);
    expect(await ghost.text()).not.toContain(secretA);
  });

  it("отзыв действует со следующего запроса, замена — тоже: старый ключ 401, новый работает", async () => {
    expect((await call("orders", keyA)).status).toBe(200);
    const fresh = (await api.createApiKey(ctxOf(A))).token;
    expect((await call("orders", keyA)).status).toBe(401);
    expect((await call("orders", fresh)).status).toBe(200);
    await api.revokeApiKey(ctxOf(A));
    expect((await call("orders", fresh)).status).toBe(401);
    // Магазин Б этим не затронут.
    expect((await call("orders", keyB)).status).toBe(200);
  });

  it("запрос с неверным ключом не расходует лимит настоящего", async () => {
    for (let i = 0; i < 130; i++) await call("orders", `ffk_${A}_${"y".repeat(43)}`);
    expect((await call("orders", keyA)).status).toBe(200);
  });
});

describe("в ответах только свой магазин", () => {
  it("заказы: список и один заказ — чужие строки не видны, чужой номер — 404", async () => {
    const list = (await (await call("orders", keyA)).json()) as { orders: Array<{ id: number }> };
    expect(list.orders.map((o) => o.id)).toEqual([1]);
    expect((await call("orders/2", keyA)).status).toBe(404);
    expect((await call("orders/1", keyA)).status).toBe(200);
  });

  it("товары: список без чужих, правка чужого товара — 404 и товар цел", async () => {
    const list = (await (await call("products", keyA)).json()) as {
      products: Array<{ id: string }>;
    };
    expect(list.products.map((p) => p.id)).toEqual([PA]);
    const r = await call(`products/${PB}`, keyA, {
      method: "PATCH",
      body: JSON.stringify({ stock: 0, price: 1 }),
    });
    expect(r.status).toBe(404);
    expect(dbs[A]!.tables.products!.find((p) => p.id === PB)).toMatchObject({
      stock_quantity: 5,
      price: 100,
    });
    const own = await call(`products/${PA}`, keyA, {
      method: "PATCH",
      body: JSON.stringify({ stock: 1 }),
    });
    expect(own.status).toBe(200);
    expect(dbs[A]!.tables.products!.find((p) => p.id === PA)!.stock_quantity).toBe(1);
  });
});

describe("лимит запросов по ключу", () => {
  it("на 121-м запросе за минуту — 429, у соседнего магазина свой счёт", async () => {
    // Окно счёта — минута; прежние тесты окно уже занимали, поэтому берём новое.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 10 * 60_000 });
    const codes: number[] = [];
    for (let i = 0; i < 121; i++) codes.push((await call("products", keyA)).status);
    expect(codes.slice(0, 120).every((c) => c === 200)).toBe(true);
    expect(codes[120]).toBe(429);
    expect((await call("products", keyB)).status).toBe(200);
    vi.useRealTimers();
  });
});
