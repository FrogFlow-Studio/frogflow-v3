import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";

/**
 * Превью и установка витрины без сервера: арендатор и база подменены.
 * Проверяем, что клиенту прежней платформы, архиву и магазину без витрины
 * ни манифест, ни иконка, ни картинка превью не выдаются.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
let tenant: Tenant;
let products: Record<string, unknown>[];
let categories: Record<string, unknown>[];
let settings: Record<string, string>;
let requestUrl = "https://www.frogflow.tech/s/shop";

function table(rows: () => Record<string, unknown>[]) {
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    in: async (_c: string, keys: string[]) => ({
      data: keys.filter((k) => k in settings).map((k) => ({ key: k, value: settings[k] })),
      error: null,
    }),
    then: (ok: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok),
  };
  return q;
}

const ctx = () =>
  ({
    tenant,
    db: {
      from: (t: string) =>
        table(() => (t === "products" ? products : t === "categories" ? categories : [])),
    },
  }) as unknown as TenantContext;

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: () => ctx(),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestUrl: () => new URL(requestUrl) }));
vi.mock("@/config/env", () => ({ env: () => ({ APP_URL: "https://www.frogflow.tech" }) }));
const approvedRating = vi.fn(async () => ({ avg: 4.5, count: 2 }));
const approvedReviews = vi.fn(async () => [
  {
    id: "r1",
    rating: 5,
    comment: "Отлично",
    createdAt: "2026-09-20T10:00:00Z",
    buyer: "Анна К.",
    photos: [],
    reply: null,
    confirmed: true,
  },
]);
vi.mock("@/core/reviews/photos.server", () => ({ approvedRating, approvedReviews }));

const { manifestResponse, iconResponse, productSeo, shareInfo } = await import("./share.server");
const { shareOrigin } = await import("@/core/storefront/share.server");

function product(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    is_active: true,
    category_ids: [],
    fulfillment_kind: "digital",
    product_images: [{ image_path: `${BOT}/${id}.jpg`, sort_order: 0 }],
    product_variants: [],
    product_material_files: [{ language: "ru", file_path: `${BOT}/${id}.pdf`, file_name: "a.pdf" }],
    ...over,
  };
}

beforeEach(() => {
  tenant = {
    id: BOT,
    name: "Магазин",
    status: "active",
    archived: false,
    modules: { shop: true, web_storefront: true },
    settings: { served_by: "v2", slug: "shop", hosts: ["shop.kz"] },
  } as unknown as Tenant;
  products = [];
  categories = [];
  settings = { shop_name: "Развивашка", storefront_accent: "#123456" };
  requestUrl = "https://www.frogflow.tech/s/shop";
});

describe("манифест и иконка витрины", () => {
  it("открытая витрина: манифест с именем и цветом магазина", async () => {
    const r = await manifestResponse("shop");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/manifest+json");
    const m = await r.json();
    expect(m).toMatchObject({ name: "Развивашка", start_url: "/s/shop", theme_color: "#123456" });
  });

  it("иконка: PNG только допустимых размеров", async () => {
    const r = await iconResponse("shop", "512");
    expect(r.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await r.arrayBuffer());
    expect(new DataView(png.buffer).getUint32(16)).toBe(512);
    for (const bad of ["64", "5120", "1e3", "abc", "0192"])
      expect((await iconResponse("shop", bad)).status).toBe(404);
  });

  it.each([
    ["клиент прежней платформы", () => (tenant.settings = { slug: "shop" } as Tenant["settings"])],
    ["архив", () => ((tenant as { archived: boolean }).archived = true)],
    ["без модуля магазина", () => (tenant.modules = {} as Tenant["modules"])],
  ])("%s — 404 и без картинки превью", async (_n, spoil) => {
    spoil();
    expect((await manifestResponse("shop")).status).toBe(404);
    expect((await iconResponse("shop", "192")).status).toBe(404);
    expect(await shareInfo("shop")).toBeNull();
  });
});

describe("магазин без витрины, только юр. страницы (shop + legal_docs)", () => {
  it("манифест и иконки — 404, превью есть, но ставить на телефон нечего", async () => {
    tenant.modules = { shop: true, legal_docs: true } as Tenant["modules"];
    expect((await manifestResponse("shop")).status).toBe(404);
    expect((await iconResponse("shop", "192")).status).toBe(404);
    const info = await shareInfo("shop");
    expect(info).toMatchObject({ installable: false, cover: null });
  });

  it("с витриной — можно установить", async () => {
    expect((await shareInfo("shop"))?.installable).toBe(true);
  });
});

describe("картинка и адрес превью", () => {
  it("фото первого товара, видного на витрине", async () => {
    categories = [{ id: "hidden", name: "h", parent_id: null, is_visible: false }];
    products = [
      product("secret", { category_ids: ["hidden"] }),
      product("empty", { product_material_files: [] }),
      product("nophoto", { product_images: [] }),
      product("shown"),
    ];
    const info = await shareInfo("shop");
    expect(info?.origin).toBe("https://www.frogflow.tech");
    expect(info?.cover).toMatch(new RegExp(`^/api/img/${BOT}/`));
    const { encodeImageKey } = await import("@/core/catalog/image-url");
    expect(info?.cover).toBe(`/api/img/${BOT}/${encodeImageKey(BOT, `${BOT}/shown.jpg`)}`);
  });

  it("свой домен магазина — ссылки от него; чужой или незнакомый хост — адрес платформы", () => {
    const app = "https://www.frogflow.tech";
    expect(shareOrigin(tenant, "https://shop.kz/s/shop", app)).toBe("https://shop.kz");
    expect(shareOrigin(tenant, "https://evil.kz/s/shop", app)).toBe(app);
    expect(shareOrigin(tenant, "http://localhost:3000/s/shop", app)).toBe(app);
    expect(shareOrigin({ settings: {} } as Tenant, "https://shop.kz/s/shop", app)).toBe(app);
  });
});

describe("разметка товара для поиска", () => {
  it("canonical — свой домен магазина, даже если страницу открыли с адреса платформы", async () => {
    expect((await shareInfo("shop"))?.canonical).toBe("https://shop.kz");
    tenant.settings = { served_by: "v2", slug: "shop" } as Tenant["settings"];
    expect((await shareInfo("shop"))?.canonical).toBe("https://www.frogflow.tech");
  });

  it("видимый товар — разметка с оценкой из одобренных отзывов", async () => {
    products = [product("shown")];
    expect(await productSeo("shop", "shown")).toEqual({
      listed: true,
      rating: { avg: 4.5, count: 2 },
      reviews: [{ author: "Анна К.", rating: 5, text: "Отлично", date: "2026-09-20T10:00:00Z" }],
    });
  });

  it.each([
    ["снят с продажи", { is_active: false }],
    ["только в скрытой категории", { category_ids: ["hidden"] }],
    ["цифровой без файлов", { product_material_files: [] }],
  ])("%s — без разметки", async (_n, over) => {
    categories = [{ id: "hidden", name: "h", parent_id: null, is_visible: false }];
    products = [product("p", over)];
    approvedRating.mockClear();
    expect(await productSeo("shop", "p")).toEqual({ listed: false, rating: null, reviews: [] });
    expect(approvedRating).not.toHaveBeenCalled();
  });

  it("нет товара — без разметки", async () => {
    expect(await productSeo("shop", "missing")).toEqual({
      listed: false,
      rating: null,
      reviews: [],
    });
  });

  it.each([
    ["клиент прежней платформы", () => (tenant.settings = { slug: "shop" } as Tenant["settings"])],
    ["архив", () => ((tenant as { archived: boolean }).archived = true)],
    [
      "только юр. страницы",
      () => (tenant.modules = { shop: true, legal_docs: true } as Tenant["modules"]),
    ],
  ])("%s — null (страница отвечает «не найден»)", async (_n, spoil) => {
    products = [product("shown")];
    spoil();
    expect(await productSeo("shop", "shown")).toBeNull();
  });
});
