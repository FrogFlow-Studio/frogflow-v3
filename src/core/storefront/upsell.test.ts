import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeUpsell } from "./catalog";

const BOT = "00000000-0000-0000-0000-0000000000aa";

function product(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: BOT,
    name: id,
    description: null,
    price: 1000,
    currency: "KZT",
    country_prices: {},
    is_active: true,
    sort_order: 0,
    category_ids: ["c1"],
    fulfillment_kind: "digital",
    stock_quantity: null,
    rating_count: 0,
    rating_avg: null,
    lead_time_days: null,
    // Встроенные связи PostgREST — вместе со строкой товара.
    product_material_files: [{ id: `${id}-f`, language: "ru", file_path: `${id}.pdf` }],
    product_images: [],
    product_variants: [],
    ...over,
  };
}

function setup(products: Array<Record<string, unknown>>, rules: unknown, modules = {}) {
  const db = fakeDb();
  db.tables.products = products;
  db.tables.categories = [
    { id: "c1", bot_id: BOT, name: "Прописи", parent_id: null, is_visible: true, sort_order: 0 },
    {
      id: "hidden",
      bot_id: BOT,
      name: "Скрытая",
      parent_id: null,
      is_visible: false,
      sort_order: 1,
    },
  ];
  db.tables.app_settings = rules
    ? [{ bot_id: BOT, key: "upsell_rules", value: JSON.stringify(rules) }]
    : [];
  const ctx = {
    tenant: { id: BOT, modules: { upsell: true, ...modules }, settings: {} },
    appUrl: "https://shop.test",
    db,
  } as unknown as TenantContext;
  return ctx;
}

const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

describe("«С этим берут» на витрине и в Mini App", () => {
  it("те же правила продавца, что в боте: по порядку, без того, что уже в корзине", async () => {
    const ctx = setup([product("a"), product("b"), product("c"), product("d")], {
      a: ["c", "b", "a"],
    });
    const out = await storeUpsell(ctx, ["a"]);
    expect(ids(out).slice(0, 2)).toEqual(["c", "b"]);
    expect(ids(out)).not.toContain("a");
    // Карточка витрины: цена, вид, в наличии — можно сразу положить в корзину.
    expect(out[0]).toMatchObject({ name: "c", price: 1000, currency: "KZT", kind: "digital" });
  });

  it("без модуля upsell — ничего", async () => {
    const ctx = setup([product("a"), product("b")], { a: ["b"] }, { upsell: false });
    expect(await storeUpsell(ctx, ["a"])).toEqual([]);
  });

  it("скрытая категория, товар без материалов и снятый с продажи не предлагаются", async () => {
    const ctx = setup(
      [
        product("a"),
        product("hid", { category_ids: ["hidden"] }),
        product("nofile", { product_material_files: [] }),
        product("off", { is_active: false }),
        product("ok"),
      ],
      { a: ["hid", "nofile", "off", "ok"] },
    );
    expect(ids(await storeUpsell(ctx, ["a"]))).toEqual(["ok"]);
  });

  it("не больше трёх предложений", async () => {
    const ctx = setup(
      ["a", "b", "c", "d", "e"].map((id) => product(id)),
      { a: ["b", "c", "d", "e"] },
    );
    expect(await storeUpsell(ctx, ["a"])).toHaveLength(3);
  });
});
