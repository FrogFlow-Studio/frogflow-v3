import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const { resetOffersCache } = await import("@/core/offers/offers");
const { storeProduct } = await import("./catalog");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const P = "11111111-1111-4111-8111-111111111111";

function shop(
  variants: Array<{ id: string; name: string; price: number; sort_order: number }>,
  offers: unknown[] = [],
) {
  const db = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: "limited_offers", value: JSON.stringify(offers) }];
  db.tables.order_items = [];
  db.tables.orders = [];
  db.tables.products = [
    {
      id: P,
      bot_id: BOT,
      name: "Прописи",
      price: 2000,
      currency: "KZT",
      is_active: true,
      fulfillment_kind: "digital",
      file_path: "f.pdf",
      product_images: [],
      product_variants: variants,
      product_material_files: [],
    },
  ];
  return {
    tenant: { id: BOT, modules: { limited_offers: true }, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
}

const ACTIVE = {
  id: "o1",
  product_id: P,
  percent: 25,
  starts_at: "2000-01-01T00:00:00Z",
  ends_at: "2999-10-01T18:59:00Z",
  limit: 10,
};

beforeEach(() => resetOffersCache());

describe("акция на витрине", () => {
  it("цена со скидкой, прежняя цена, процент, срок и остаток", async () => {
    const p = await storeProduct(shop([], [ACTIVE]), P);
    expect(p).toMatchObject({
      price: 1500,
      offer: {
        percent: 25,
        oldPrice: 2000,
        endsAt: ACTIVE.ends_at,
        left: 10,
        tz: "Asia/Almaty",
      },
    });
  });

  it("у вариантов — своя прежняя цена, у карточки — от самого дешёвого", async () => {
    const p = await storeProduct(
      shop(
        [
          { id: "v-big", name: "A4", price: 4000, sort_order: 0 },
          { id: "v-small", name: "A5", price: 1000, sort_order: 1 },
        ],
        [{ ...ACTIVE, limit: null }],
      ),
      P,
    );
    expect(p?.price).toBe(750);
    expect(p?.offer).toMatchObject({ oldPrice: 1000, left: null });
    expect(p?.variants.map((v) => [v.id, v.price, v.oldPrice])).toEqual([
      ["v-big", 3000, 4000],
      ["v-small", 750, 1000],
    ]);
  });

  it("без акции — ни прежней цены, ни подписи", async () => {
    const ended = { ...ACTIVE, ends_at: "2001-01-01T00:00:00Z" };
    const p = await storeProduct(
      shop([{ id: "v", name: "A4", price: 4000, sort_order: 0 }], [ended]),
      P,
    );
    expect(p?.offer).toBeNull();
    expect(p?.variants[0]?.oldPrice).toBeNull();
    expect(p?.price).toBe(4000);
  });
});
