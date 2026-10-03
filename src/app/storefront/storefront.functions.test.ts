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
/** Сколько ссылок подписано и сколько раз звали водяной знак — это и есть нагрузка библиотеки. */
const heavy = { signed: 0, protect: 0 };
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string) => {
          heavy.signed++;
          return { data: { signedUrl: `https://s.test/${key}` } };
        },
      }),
    },
  }),
}));
vi.mock("@/core/delivery/watermark.server", async (orig) => {
  const real = await orig<typeof import("@/core/delivery/watermark.server")>();
  return {
    ...real,
    protectMaterials: (...a: Parameters<typeof real.protectMaterials>) => {
      heavy.protect++;
      return real.protectMaterials(...a);
    },
  };
});

const { storeProductFn, miniAppOrdersFn, miniAppCheckoutFn } =
  await import("./storefront.functions");
const { MINI_APP_BUDGETS } = await import("@/core/storefront/rate-limit");
const { LIBRARY_FILES } = await import("./storefront.functions");

type Row = Record<string, unknown>;

/** Товары: eq, in и contains по jsonb-массиву — то, чем пользуется каталог витрины. */
function productsTable(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let one = false;
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    range: () => q,
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return q;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
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
    const db = fakeDb();
    db.tables.categories = ["math", "history"].map((c) => ({
      id: c,
      name: c,
      parent_id: null,
      is_visible: true,
      sort_order: 0,
    }));
    tenantWith(db, products);
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

  it("товар из скрытой категории не попадает в похожие", async () => {
    const db = fakeDb();
    db.tables.categories = [
      { id: "math", name: "math", parent_id: null, is_visible: true, sort_order: 0 },
      { id: "secret", name: "secret", parent_id: null, is_visible: false, sort_order: 0 },
    ];
    tenantWith(db, [product(T, []), product("open", ["math"]), product("hidden", ["secret"])]);
    const r = await storeProductFn({ data: { slug: "shop", id: T } });
    expect(r.related.map((p) => p.id)).toEqual(["open"]);
  });
});

describe("miniAppOrdersFn: «Мои материалы»", () => {
  const TG = 555;

  function withOrders(orders: Row[], products: Row[] = []) {
    const db = fakeDb();
    db.tables.bot_users = [{ user_key: `tg_${TG}`, telegram_id: TG, state: {} }];
    db.tables.orders = orders;
    tenantWith(db, products);
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
      {
        orderNo: 2,
        item: "Рабочий лист",
        name: "ws.pdf",
        // Ссылка несёт имя для скачивания — файл сохранится как «ws.pdf».
        url: `https://s.test/${BOT}/ws.pdf?download=ws.pdf`,
        lang: "ru",
        cover: null,
      },
    ]);
  });

  it("название и обложка — у товара сейчас, файл — из заказа", async () => {
    withOrders(
      [
        order(1, "digital", [
          {
            product_id: "p1",
            name_snapshot: "Старое имя",
            quantity: 1,
            material_files_by_lang: {
              kk: [{ path: `${BOT}/kk.pdf`, name: "kk.pdf", url: null }],
            },
          },
        ]),
      ],
      [
        {
          id: "p1",
          name: "Новое имя",
          product_images: [
            { image_path: `${BOT}/b.jpg`, sort_order: 1 },
            { image_path: `${BOT}/a.jpg`, sort_order: 0 },
          ],
        },
      ],
    );
    const r = await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } });
    expect(r.library).toMatchObject([{ item: "Новое имя", name: "kk.pdf", lang: "kk" }]);
    expect(r.library[0]!.cover).toContain("/api/img/");
    // Без модуля «Мультиязычность» метки языка не рисуются, файл при этом остаётся.
    expect(r.libraryLangs).toBe(false);
  });

  const sheet = (product: string, file: string): Row => ({
    product_id: product,
    name_snapshot: `Лист ${product}`,
    quantity: 1,
    material_files_by_lang: { ru: [{ path: `${BOT}/${file}`, name: file, url: null }] },
  });

  it("товар из заказа старше последних 30 не пропадает: библиотека листается страницами", async () => {
    const orders = [order(1, "digital", [sheet("old", "old.pdf")])];
    for (let i = 2; i <= 45; i++) orders.push(order(i, "digital", [sheet(`p${i}`, `p${i}.pdf`)]));
    // created_at у order() — «2026-09-(10+id)»: 45 дней не влезут, даём свои даты.
    orders.forEach((o, i) => (o.created_at = new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    withOrders(orders);
    const page = async (libraryOffset?: number) => {
      heavy.signed = heavy.protect = 0;
      const r = await miniAppOrdersFn({
        data: { slug: "shop", initData: initData(TG), libraryOffset },
      });
      // Водяной знак и подпись — только для товаров этой страницы, не для всей истории.
      expect(heavy.protect).toBeLessThanOrEqual(LIBRARY_FILES);
      expect(heavy.signed).toBeLessThanOrEqual(LIBRARY_FILES);
      return r;
    };
    const first = await page();
    expect(first.orders).toHaveLength(30);
    expect(first.library[0]).toMatchObject({ orderNo: 45 });
    // Листаем до конца: каждый товар ровно один раз, самый старый — последним.
    const all = [...first.library];
    let next = first.libraryNext;
    while (next != null) {
      const r = await page(next);
      all.push(...r.library);
      next = r.libraryNext;
    }
    expect(all).toHaveLength(45);
    expect(all.at(-1)).toMatchObject({ orderNo: 1, name: "old.pdf" });
  });

  it("товары с файлами на двух языках: за запрос не больше LIBRARY_FILES файлов", async () => {
    // Как у AATeach: в товаре ru и kk. 20 товаров × 2 файла — это 40 штамповок,
    // каждая со скачиванием и загрузкой до 21 МБ: не уложится в лимит функции.
    const two = (product: string): Row => ({
      product_id: product,
      name_snapshot: `Лист ${product}`,
      quantity: 1,
      material_files_by_lang: {
        ru: [{ path: `${BOT}/${product}-ru.pdf`, name: `${product}-ru.pdf`, url: null }],
        kk: [{ path: `${BOT}/${product}-kk.pdf`, name: `${product}-kk.pdf`, url: null }],
      },
    });
    const orders: Row[] = [];
    for (let i = 1; i <= 10; i++) orders.push(order(i, "digital", [two(`b${i}`)]));
    withOrders(orders);
    heavy.signed = 0;
    const r = await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } });
    expect(heavy.signed).toBeLessThanOrEqual(LIBRARY_FILES);
    expect(r.library).toHaveLength(LIBRARY_FILES);
    // Товар не режется пополам: оба языка одного товара — на одной странице.
    expect(r.libraryNext).toBe(LIBRARY_FILES / 2);
    const next = await miniAppOrdersFn({
      data: { slug: "shop", initData: initData(TG), libraryOffset: r.libraryNext! },
    });
    expect(next.library[0]!.name).toBe(`b${10 - LIBRARY_FILES / 2}-ru.pdf`);
  });

  it("дедуплицирует по товару, оставляя самый свежий заказ", async () => {
    withOrders([
      order(1, "digital", [sheet("same", "v1.pdf")]),
      order(2, "digital", [sheet("same", "v2.pdf"), sheet("other", "o.pdf")]),
    ]);
    const r = await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } });
    expect(r.library.map((l) => [l.orderNo, l.name])).toEqual([
      [2, "v2.pdf"],
      [2, "o.pdf"],
    ]);
  });

  it("нет покупателя или заказов — пустая библиотека, без похода за товарами", async () => {
    tenantWith(fakeDb());
    expect(await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } })).toEqual({
      orders: [],
      library: [],
      libraryNext: null,
      libraryLangs: false,
    });
    withOrders([]);
    expect(await miniAppOrdersFn({ data: { slug: "shop", initData: initData(TG) } })).toEqual({
      orders: [],
      library: [],
      libraryNext: null,
      libraryLangs: false,
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
    await expect(call(778)).resolves.toEqual({
      orders: [],
      library: [],
      libraryNext: null,
      libraryLangs: false,
    });
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

describe("Mini App: заблокированный покупатель", () => {
  it("корзину в бота не переносит; отказ без слова «заблокирован»", async () => {
    const db = fakeDb();
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 780 }];
    db.tables.bot_users = [];
    db.tables.cart_items = [];
    tenantWith(db);
    (ctx.tenant.modules as Record<string, boolean>).blocked = true;
    const err = await miniAppCheckoutFn({
      data: {
        slug: "shop",
        initData: initData(780),
        items: [{ product_id: "aaaaaaaa-0000-4000-8000-000000000000", quantity: 1 }],
      },
    }).catch((e: Error) => e.message);
    expect(err).toBe("Оформить заказ сейчас нельзя. Свяжитесь с магазином.");
    expect(err).not.toMatch(/блок/i);
    expect(db.tables.bot_users).toEqual([]);
    expect(db.tables.cart_items).toEqual([]);
  });
});
