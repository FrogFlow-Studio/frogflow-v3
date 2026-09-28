import { createFileRoute } from "@tanstack/react-router";

/**
 * Публичный API магазина (core/api/public-api, модуль public_api):
 *
 *   GET   /api/v1/orders?status=&updated_since=&limit=&before_id=
 *   GET   /api/v1/orders/<id>
 *   GET   /api/v1/products
 *   PATCH /api/v1/products/<id>   {"stock": 5 | null, "price": 1000, "active": true}
 *
 * Ключ — `Authorization: Bearer ffk_<bot_id>_<секрет>`, магазин берётся из
 * ключа. Клиент прежней платформы (servedByV2) и выключенный модуль — 404,
 * неверный ключ — 401, больше 120 запросов в минуту — 429.
 */
export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat ?? ""),
      PATCH: ({ request, params }) => handle(request, params._splat ?? ""),
    },
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status: number, error: string) => json({ error }, status);

const PRODUCT_COLUMNS =
  "id, name, price, currency, is_active, stock_quantity, fulfillment_kind, category_id, sort_order, description";

async function handle(request: Request, path: string): Promise<Response> {
  const api = await import("@/core/api/public-api");
  const auth = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? request.headers.get("x-api-key");
  const key = api.splitApiToken(token);
  if (!key) return fail(401, "unauthorized");
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const tenant = await resolveTenant({ by: "id", value: key.botId });
  // Магазин прежней платформы для v2 невидим (servedByV2); без модуля API нет.
  if (
    !tenant ||
    tenant.archived ||
    tenant.settings.served_by !== "v2" ||
    !tenant.modules.public_api
  )
    return fail(404, "not_found");
  const ctx = tenantContext(tenant);
  if (!api.secretMatches(key.secret, await api.loadApiKeyMeta(ctx)))
    return fail(401, "unauthorized");
  const { takeShared } = await import("@/core/storefront/rate-limit");
  if (!(await takeShared(ctx, "api", "key", { limit: 120, windowMs: 60_000 })))
    return fail(429, "rate_limited");

  const parts = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  try {
    if (parts[0] === "orders" && method === "GET") {
      if (parts.length === 1) return await listOrders(ctx, new URL(request.url));
      const id = Number(parts[1]);
      if (parts.length !== 2 || !Number.isInteger(id) || id <= 0) return fail(404, "not_found");
      const { getOrder } = await import("@/core/orders/orders");
      const order = await getOrder(ctx, id);
      return order ? json({ order: api.apiOrder(order) }) : fail(404, "not_found");
    }
    if (parts[0] === "products" && parts.length === 1 && method === "GET") {
      const { data, error } = await ctx.db
        .from("products")
        .select(PRODUCT_COLUMNS)
        .order("sort_order")
        .limit(2000);
      if (error) throw new Error(error.message);
      return json({ products: (data ?? []).map((p) => api.apiProduct(p)) });
    }
    if (parts[0] === "products" && parts.length === 2 && method === "PATCH")
      return await patchProduct(ctx, parts[1]!, request);
    return fail(404, "not_found");
  } catch (e) {
    console.error(`[api:${ctx.tenant.id}] ${method} /${path}`, e);
    return fail(500, "internal_error");
  }
}

async function listOrders(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  url: URL,
): Promise<Response> {
  const api = await import("@/core/api/public-api");
  const q = api.orderListQuery(url);
  if (!q) return fail(400, "bad_query");
  let query = ctx.db.from("orders").select("*, order_items(*)");
  if (q.status) query = query.eq("status", q.status);
  if (q.since) query = query.gte("updated_at", q.since);
  if (q.before) query = query.lt("id", q.before);
  const { data, error } = await query.order("id", { ascending: false }).limit(q.limit);
  if (error) throw new Error(error.message);
  const orders = (data ?? []) as unknown as import("@/core/orders/orders").OrderWithItems[];
  return json({
    orders: orders.map(api.apiOrder),
    // Следующая страница: before_id = id последнего заказа в ответе.
    next_before_id: orders.length === q.limit ? orders[orders.length - 1]!.id : null,
  });
}

async function patchProduct(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  id: string,
  request: Request,
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found");
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return fail(413, "too_large");
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail(400, "bad_json");
  }
  const patch: { stock_quantity?: number | null; price?: number; is_active?: boolean } = {};
  if ("stock" in body) {
    const s = body.stock;
    if (s !== null && !(Number.isInteger(s) && (s as number) >= 0 && (s as number) <= 1_000_000))
      return fail(400, "bad_stock");
    patch.stock_quantity = s as number | null;
  }
  if ("price" in body) {
    const p = body.price;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1e9)
      return fail(400, "bad_price");
    patch.price = Math.round(p * 100) / 100;
  }
  if ("active" in body) {
    if (typeof body.active !== "boolean") return fail(400, "bad_active");
    patch.is_active = body.active;
  }
  if (Object.keys(patch).length === 0) return fail(400, "nothing_to_update");
  const { data: before } = await ctx.db
    .from("products")
    .select("is_active, stock_quantity, name")
    .eq("id", id)
    .maybeSingle();
  if (!before) return fail(404, "not_found");
  const { data, error } = await ctx.db
    .from("products")
    .update(patch)
    .eq("id", id)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return fail(404, "not_found");
  // Товар вернулся в продажу — лист ожидания получает сообщение, как из админки.
  if (ctx.tenant.modules.waitlist) {
    const { backInStock } = await import("@/core/waitlist/waitlist");
    if (backInStock(before, data)) {
      const { notifyBackInStock } = await import("@/app/waitlist/notify.server");
      await notifyBackInStock(ctx, { id, name: data.name }).catch((e) =>
        console.error(`[api:${ctx.tenant.id}] лист ожидания ${id}`, e),
      );
    }
  }
  const { apiProduct } = await import("@/core/api/public-api");
  return json({ product: apiProduct(data) });
}
