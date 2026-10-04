import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const patch = vi.fn(async (_id: string, _p: Record<string, unknown>) => {});
vi.mock("@/core/tenant/resolve.server", () => ({ patchTenantSettings: patch }));

const { adminCollections, saveCollection, deleteCollection } = await import("./collections.server");

const BOT = "00000000-0000-0000-0000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ctx(collections: unknown) {
  const db = fakeDb({ maxRows: 1000 });
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: id(n),
    bot_id: BOT,
    name: `Товар ${n}`,
    description: "",
    price: 100,
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
  db.tables.products = [row(1), row(2, { is_active: false })];
  db.tables.categories = [];
  return {
    tenant: { id: BOT, modules: {}, settings: { slug: "lavka", collections } },
    appUrl: "https://app.test",
    db,
  } as unknown as TenantContext;
}
const col = { id: "abcd1234", name: "Подарки", product_ids: [id(1), id(2), id(9)], created_at: "" };

describe("подборки в админке", () => {
  it("видно ссылку и состояние каждого товара: в продаже, снят, удалён", async () => {
    const [c] = await adminCollections(ctx([col]));
    expect(c!.url).toBe("https://app.test/s/lavka/col/abcd1234");
    expect(c!.products.map((p) => [p.id, p.state, p.name])).toEqual([
      [id(1), "ok", "Товар 1"],
      [id(2), "hidden", "Товар 2"],
      [id(9), "gone", ""],
    ]);
  });

  it("сохранение пишет только ключ collections (остальные настройки не трогаем)", async () => {
    patch.mockClear();
    await saveCollection(ctx([col]), { id: "abcd1234", name: "Новинки", productIds: [id(1)] });
    expect(patch).toHaveBeenCalledTimes(1);
    const [bot, body] = patch.mock.calls[0]!;
    expect(bot).toBe(BOT);
    expect(Object.keys(body)).toEqual(["collections"]);
    expect(body.collections).toMatchObject([
      { id: "abcd1234", name: "Новинки", product_ids: [id(1)] },
    ]);
  });

  it("удаление убирает только выбранную подборку", async () => {
    patch.mockClear();
    const other = { ...col, id: "zzzz0000", name: "Другая" };
    await deleteCollection(ctx([col, other]), "abcd1234");
    expect((patch.mock.calls[0]![1].collections as Array<{ id: string }>).map((c) => c.id)).toEqual(
      ["zzzz0000"],
    );
  });
});
