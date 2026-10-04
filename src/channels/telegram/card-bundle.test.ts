import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog/catalog";
import { resetPricingCache } from "@/core/pricing/pricing";
import { resetOffersCache } from "@/core/offers/offers";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { BUNDLE_CARD } from "@/core/bundles/card";
import { bundleShop, SET } from "../../../tests/bundle-shop";
import { productCard } from "./screens";

const setProduct = (stock: number | null) =>
  ({
    id: SET,
    name: "Набор уход",
    description: null,
    price: 3000,
    currency: "KZT",
    country_prices: {},
    fulfillment_kind: "physical",
    stock_quantity: stock,
    category_ids: [],
    product_images: [],
    product_variants: [],
  }) as unknown as Product;

const callbacks = (kb: { inline_keyboard: Array<Array<{ callback_data?: string }>> }) =>
  kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
});

describe("карточка набора в Telegram", () => {
  it("состав списком, выгода и «В корзину» на каждом языке", async () => {
    for (const l of SUPPORTED_LOCALES) {
      const { ctx } = bundleShop();
      const card = await productCard(ctx, setProduct(5), l, null);
      expect(card.caption).toContain(BUNDLE_CARD[l].contains);
      expect(card.caption).toContain("• Шампунь × 2");
      expect(card.caption).toContain("• Бальзам (250 мл) × 1");
      expect(callbacks(card.keyboard)).toContain(`add:${SET}`);
    }
  });

  it("набор без остатка: нет «Сообщить о поступлении» и предзаказа", async () => {
    const { ctx } = bundleShop({ modules: { bundles: true, stock: true, waitlist: true } });
    const card = await productCard(ctx, setProduct(0), "ru", null);
    expect(callbacks(card.keyboard).some((c) => c.startsWith("wait:"))).toBe(false);
    expect(callbacks(card.keyboard).some((c) => c.startsWith("add:"))).toBe(false);
    expect(card.caption).toContain("Нет в наличии");
  });

  it("обычный товар без остатка по-прежнему получает лист ожидания", async () => {
    const { ctx } = bundleShop({ modules: { bundles: true, stock: true, waitlist: true } });
    const plain = { ...setProduct(0), id: "b0000000-0000-4000-8000-000000000002" } as Product;
    const card = await productCard(ctx, plain, "ru", null);
    expect(callbacks(card.keyboard).some((c) => c.startsWith("wait:"))).toBe(true);
  });

  it("скрытый компонент — без кнопок покупки, с пометкой", async () => {
    const { ctx } = bundleShop({ balmActive: false });
    const card = await productCard(ctx, setProduct(5), "ru", null);
    expect(card.keyboard.inline_keyboard).toEqual([]);
    expect(card.caption).toContain("Набор временно недоступен");
  });
});
