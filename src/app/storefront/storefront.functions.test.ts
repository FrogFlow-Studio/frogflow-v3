import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { signInitData } from "@/core/storefront/init-data";

/**
 * Серверные функции витрины и Mini App без сервера: createServerFn
 * подменён построителем, который зовёт обработчик напрямую, арендатор —
 * фейковый, база — в памяти.
 */
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

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
const BOT = "11111111-1111-1111-1111-111111111111";
let ctx: TenantContext;
let tables: string[] = [];

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ctx.tenant,
  tenantContext: () => ctx,
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://s.test/${key}` } }),
      }),
    },
  }),
}));

const { storeProductFn, miniAppOrdersFn, miniAppCheckoutFn } =
  await import("./storefront.functions");
const { MINI_APP_BUDGETS } = await import("@/core/storefront/rate-limit");

type Row = Record<string, unknown>;

/** Товары: eq и contains по jsonb-массиву — то, чем пользуется каталог витрины. */
function productsTable(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let one = false;
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return q;
    },
    contains(col: string, json: string) {
      const need = JSON.parse(json) as unknown[];
      filters.push((r) => need.every((x) => ((r[col] as unknown[]) ?? []).includes(x)));
      return q;
    },
    maybeSingle() {
      one = true;
      return q;
    },
    then(ok: (v: { data: unknown; error: null }) => unknown) {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: one ? (hit[0] ?? null) : hit, error: null }).then(ok);
    },
  };
  return q;
}

function tenantWith(db: FakeDb, products: Row[] = []) {
  ctx = {
    tenant: {
      id: BOT,
      status: "active",
      archived: false,
      telegramTokenEnc: "enc",
      modules: { shop: true, telegram_mini_app: true, web_storefront: true },
      settings: { served_by: "v2", slug: "shop", default_locale: "ru" },
    },
    db: {
      from(t: string) {
        tables.push(t);
        return t === "products" ? productsTable(products) : db.from(t);
      },
    },
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
    secrets: { telegramToken: () => TOKEN },
  } as unknown as TenantContext;
}

function product(id: string, categoryIds: string[]): Row {
  return {
    id,
    name: `Материал ${id}`,
    description: null,
    price: 500,
    currency: "KZT",
    is_active: true,
    category_ids: categoryIds,
    fulfillment_kind: "digital",
    rating_count: 0,
    product_images: [],
    product_variants: [],
    product_material_files: [{ language: "ru", file_path: `${BOT}/${id}.pdf`, file_name: "a.pdf" }],
  };
}

const initData = (id: number) =>
  signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id, first_name: "A" }),
    },
    TOKEN,
  );

beforeEach(() => {
  tables = [];
});

describe("storeProductFn: похожие товары", () => {
  const related = async (products: Row[], id: string) => {
    tenantWith(fakeDb(), products);
    const r = await storeProductFn({ data: { slug: "shop", id } });
    return r.related.map((p) => p.id);
  };
  const T = "aaaaaaaa-0000-4000-8000-000000000000";

  it("товар без категории всё равно получает похожие — из всего каталога", async () => {
    expect(
      await related([product(T, []), product("other-1", ["math"]), product("other-2", [])], T),
    ).toEqual(["other-1", "other-2"]);
  });

  it("товар с категорией — похожие только из его первой категории", async () => {
    expect(
      await related(
        [product(T, ["math"]), product("same-cat", ["math"]), product("other-cat", ["history"])],
        T,
      ),
    ).toEqual(["same-cat"]);
  });

  it("других товаров нет — похожих нет, секция на странице не рисуется", async () => {
    expect(await related([product(T, [])], T)).toEqual([]);
  });
});

describe("miniAppOrdersFn: «Мои материалы»", () => {
  const TG = 555;

  function withOrders(orders: Row[]) {
    const db = fakeDb();
    db.tables.bot_users = [{ user_key: `tg_${TG}`, telegram_id: TG, state: {} }];
    db.tables.orders = orders;
    tenantWith(db);
  }

  function order(id: number, kind: string, items: Row[]): Row {
    return {
      id,
      order_no: id,
      telegram_id: TG,
      status: "delivered",
      fulfillment_kind: kind,
      total: 1000,
      currency: "KZT",
      created_at: `2026-09-${10 + id}T10:00:00Z`,
      order_items: items,
    };
  }

  it("библиотека — только выданные файлы: физический заказ в неё не попадает", async () => {
    withOrders([
      order(1, "physical", [{ name_snapshot: "Торт", quantity: 1 }]),
      order(2, "digital", [
        {
          name_snapshot: "Рабочий лист",
          quantity: 1,
          material_files_by_lang: {
            ru: [{ path: `${BOT}/ws.pdf`, name: "ws.pdf", url: null }],
          },
        },
      ]),
    ]);
    const r = await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } });
    expect(r.orders.map((o) => o.no)).toEqual([2, 1]);
    expect(r.library).toEqual([
      { orderNo: 2, item: "Рабочий лист", name: "ws.pdf", url: `https://s.test/${BOT}/ws.pdf` },
    ]);
  });

  it("нет покупателя или заказов — пустая библиотека, без похода за товарами", async () => {
    tenantWith(fakeDb());
    expect(await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } })).toEqual({
      orders: [],
      library: [],
    });
    withOrders([]);
    expect(await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } })).toEqual({
      orders: [],
      library: [],
    });
    expect(tables).not.toContain("products");
  });
});

describe("лимит частоты Mini App", () => {
  it("«Мои заказы»: после лимита покупатель получает понятный отказ, другой покупатель — нет", async () => {
    tenantWith(fakeDb());
    const call = (tg: number) =>
      miniAppOrdersFn({ data: { slug: "shop", initData: initData(tg) } });
    for (let i = 0; i < MINI_APP_BUDGETS.orders.limit; i++) await call(777);
    await expect(call(777)).rejects.toThrow("Слишком много запросов");
    await expect(call(778)).resolves.toEqual({ orders: [], library: [] });
  });

  it("оформление: пачка запросов упирается в лимит до похода в базу и в Telegram", async () => {
    tenantWith(fakeDb());
    const call = () =>
      miniAppCheckoutFn({
        data: {
          slug: "shop",
          initData: initData(779),
          items: [{ product_id: "aaaaaaaa-0000-4000-8000-000000000000", quantity: 1 }],
        },
      }).catch((e: Error) => e.message);
    for (let i = 0; i < MINI_APP_BUDGETS.checkout.limit; i++) await call();
    tables = [];
    expect(await call()).toContain("Слишком много запросов");
    expect(tables).toEqual([]);
  });
});
