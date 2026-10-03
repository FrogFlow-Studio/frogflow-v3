import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Product } from "@/core/catalog/catalog";
import { OFFERS_KEY, resetOffersCache } from "@/core/offers/offers";
import { resetPricingCache } from "@/core/pricing/pricing";
import { productCard } from "./screens";

const BOT = "00000000-0000-0000-0000-0000000000c4";
const product = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Торт",
  description: "Вкусный",
  price: 10000,
  currency: "KZT",
  country_prices: {},
  fulfillment_kind: "physical",
  stock_quantity: null,
  category_ids: [],
  product_images: [],
  product_variants: [],
} as unknown as Product;

function ctx(offers: unknown[]) {
  const db = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(offers) }];
  db.tables.order_items = [];
  return {
    tenant: { id: BOT, modules: { limited_offers: true }, settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}
const offer = {
  id: "s1",
  product_id: product.id,
  percent: 20,
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-10-12T18:59:00Z",
  limit: null,
};

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
});

describe("карточка товара в боте при акции", () => {
  it("прежняя цена зачёркнута, новая рядом, срок на языке покупателя", async () => {
    const card = await productCard(ctx([offer]), product, "kk", null);
    expect(card.caption).toContain("<s>10000 ₸</s> <b>8000 ₸</b>");
    expect(card.caption).toContain("−20%");
    expect(card.caption).toContain("дейін");
  });
  it("акция кончилась — обычная цена без зачёркивания", async () => {
    const card = await productCard(
      ctx([{ ...offer, ends_at: "2026-10-05T09:00:00Z" }]),
      product,
      "ru",
      null,
    );
    expect(card.caption).not.toContain("<s>");
    expect(card.caption).toContain("<b>10000 ₸</b>");
  });
});
