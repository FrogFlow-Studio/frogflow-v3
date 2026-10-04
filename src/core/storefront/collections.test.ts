import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCollection } from "./collection-page";
import {
  COLLECTIONS_MAX,
  COLLECTION_PRODUCTS_MAX,
  collectionUrl,
  parseCollections,
  removeCollection,
  upsertCollection,
} from "./collections";

const BOT = "00000000-0000-0000-0000-000000000001";
const HIDDEN = "00000000-0000-4000-8000-00000000c0de";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-10-04T10:00:00.000Z";

describe("подборки: хранение в settings", () => {
  it("битое, чужое и повторы отбрасываются, лимиты соблюдаются", () => {
    expect(parseCollections(undefined)).toEqual([]);
    expect(parseCollections("x")).toEqual([]);
    const raw = [
      { id: "abcd1234", name: "  Подарки  ", product_ids: [id(1), id(1), "не-uuid", id(2)] },
      { id: "abcd1234", name: "Повтор id", product_ids: [] },
      { id: "BAD", name: "Плохой код", product_ids: [] },
      { id: "efgh5678", name: "   ", product_ids: [] },
      { id: "ijkl9012", name: "Без товаров" },
      null,
    ];
    expect(parseCollections(raw)).toEqual([
      { id: "abcd1234", name: "Подарки", product_ids: [id(1), id(2)], created_at: "" },
      { id: "ijkl9012", name: "Без товаров", product_ids: [], created_at: "" },
    ]);
    const many = Array.from({ length: COLLECTIONS_MAX + 5 }, (_, i) => ({
      id: `c${String(i).padStart(7, "0")}`,
      name: `П${i}`,
      product_ids: [],
    }));
    expect(parseCollections(many)).toHaveLength(COLLECTIONS_MAX);
  });

  it("новая подборка получает код, изменение сохраняет код и дату", () => {
    const a = upsertCollection(
      [],
      { name: " Новинки ", productIds: [id(1), id(2), id(1)] },
      NOW,
      () => "aaaa1111",
    );
    expect(a.list).toEqual([
      { id: "aaaa1111", name: "Новинки", product_ids: [id(1), id(2)], created_at: NOW },
    ]);
    const b = upsertCollection(
      a.list,
      { id: "aaaa1111", name: "Новинки октября", productIds: [id(2)] },
      "later",
    );
    expect(b.id).toBe("aaaa1111");
    expect(b.list).toEqual([
      { id: "aaaa1111", name: "Новинки октября", product_ids: [id(2)], created_at: NOW },
    ]);
  });

  it("код не повторяется; пустое название и лишние подборки — понятная ошибка", () => {
    const first = upsertCollection([], { name: "А", productIds: [] }, NOW, () => "same0001");
    const ids = ["same0001", "same0002"];
    const second = upsertCollection(first.list, { name: "Б", productIds: [] }, NOW, () =>
      ids.shift()!,
    );
    expect(second.id).toBe("same0002");
    expect(() => upsertCollection([], { name: "  ", productIds: [] }, NOW)).toThrow("Назовите");
    const full = Array.from({ length: COLLECTIONS_MAX }, (_, i) => ({
      id: `c${String(i).padStart(7, "0")}`,
      name: `П${i}`,
      product_ids: [],
      created_at: NOW,
    }));
    expect(() => upsertCollection(full, { name: "Ещё", productIds: [] }, NOW)).toThrow(
      `не больше ${COLLECTIONS_MAX}`,
    );
    // Изменить существующую можно и при полном списке.
    expect(() =>
      upsertCollection(full, { id: full[0]!.id, name: "Переименована", productIds: [] }, NOW),
    ).not.toThrow();
  });

  it("товаров в подборке не больше лимита; удаление убирает только её", () => {
    const many = Array.from({ length: COLLECTION_PRODUCTS_MAX + 7 }, (_, i) => id(i + 1));
    const r = upsertCollection([], { name: "Много", productIds: many }, NOW, () => "many0001");
    expect(r.list[0]!.product_ids).toHaveLength(COLLECTION_PRODUCTS_MAX);
    const two = upsertCollection(r.list, { name: "Вторая", productIds: [] }, NOW, () => "two00002");
    expect(removeCollection(two.list, "many0001").map((c) => c.id)).toEqual(["two00002"]);
  });

  it("ссылка ведёт на страницу подборки витрины", () => {
    expect(collectionUrl("https://shop.kz/s/lavka", "abcd1234")).toBe(
      "https://shop.kz/s/lavka/col/abcd1234",
    );
  });
});

function shop(collections: unknown) {
  const db = fakeDb({ maxRows: 1000 });
  const product = (n: number, extra: Record<string, unknown> = {}) => ({
    id: id(n),
    bot_id: BOT,
    name: `Товар ${n}`,
    description: "",
    price: 100 * n,
    currency: "KZT",
    country_prices: {},
    is_active: true,
    sort_order: n,
    fulfillment_kind: "physical",
    stock_quantity: null,
    category_ids: [],
    rating_count: 0,
    rating_avg: 0,
    created_at: "2026-01-01T00:00:00Z",
    product_images: [],
    product_variants: [],
    product_material_files: [],
    ...extra,
  });
  db.tables.products = [
    product(1),
    product(2, { is_active: false }),
    product(3, { category_ids: [HIDDEN] }),
    product(4, { stock_quantity: 0 }),
    product(5),
  ];
  db.tables.categories = [{ id: HIDDEN, name: "Скрытая", parent_id: null, is_visible: false }];
  return {
    tenant: { id: BOT, modules: { stock: true }, settings: { collections } },
    db,
  } as unknown as TenantContext;
}

describe("страница подборки", () => {
  const col = {
    id: "abcd1234",
    name: "Подарки",
    product_ids: [id(5), id(2), id(3), id(4), id(404), id(1)],
    created_at: NOW,
  };

  it("скрытый, снятый, удалённый и закончившийся товар не показывается, порядок продавца", async () => {
    const page = await storeCollection(shop([col]), "abcd1234");
    expect(page?.name).toBe("Подарки");
    expect(page?.items.map((p) => p.id)).toEqual([id(5), id(1)]);
  });

  it("чужого или удалённого кода нет — null, без падения", async () => {
    expect(await storeCollection(shop([col]), "zzzz9999")).toBeNull();
    expect(await storeCollection(shop(undefined), "abcd1234")).toBeNull();
  });

  it("подборка, где все товары удалены, открывается пустой", async () => {
    const page = await storeCollection(
      shop([{ ...col, product_ids: [id(404), id(405)] }]),
      "abcd1234",
    );
    expect(page?.items).toEqual([]);
  });
});
