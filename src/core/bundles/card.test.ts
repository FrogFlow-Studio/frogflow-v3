import { beforeEach, describe, expect, it } from "vitest";
import { bundleShop, SET, SHAMPOO } from "../../../tests/bundle-shop";
import { resetPricingCache } from "@/core/pricing/pricing";
import { resetOffersCache } from "@/core/offers/offers";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { BUNDLE_CARD, bundleCardInfo, bundleCardLines } from "./card";

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
});

describe("карточка набора: данные", () => {
  it("состав, выгода по отдельности и доступность", async () => {
    const { ctx } = bundleShop();
    const info = await bundleCardInfo(ctx, SET);
    expect(info?.parts).toEqual(["Шампунь × 2", "Бальзам (250 мл) × 1"]);
    // по отдельности 2×2000 + 1500 = 5500, набор 3000
    expect(info?.saving?.amount).toContain("2");
    expect(info?.available).toBe(true);
  });

  it("остаток набора — по составляющим: 0 при пустом бальзаме, без учёта склада null", async () => {
    const out = bundleShop({
      modules: { bundles: true, stock: true },
      stock: { shampoo: 9, balm: 0 },
    });
    expect((await bundleCardInfo(out.ctx, SET))?.capacity).toBe(0);
    const some = bundleShop({
      modules: { bundles: true, stock: true },
      stock: { shampoo: 5, balm: 9 },
    });
    expect((await bundleCardInfo(some.ctx, SET))?.capacity).toBe(2); // шампуня 5 / 2
    const noModule = bundleShop({ stock: { balm: 0 } });
    expect((await bundleCardInfo(noModule.ctx, SET))?.capacity).toBeNull();
  });

  it("обычный товар и выключенный модуль — не набор", async () => {
    const { ctx } = bundleShop();
    expect(await bundleCardInfo(ctx, SHAMPOO)).toBeNull();
    const off = bundleShop({ modules: {} });
    expect(await bundleCardInfo(off.ctx, SET)).toBeNull();
  });

  it("скрытый компонент — набор недоступен, пометка в тексте", async () => {
    const { ctx } = bundleShop({ balmActive: false });
    const info = await bundleCardInfo(ctx, SET);
    expect(info?.available).toBe(false);
    expect(bundleCardLines(info!, "ru").join("\n")).toContain("Набор временно недоступен");
  });
});

describe("карточка набора: тексты", () => {
  it("на всех четырёх языках: заголовок состава, выгода, пометка", async () => {
    const { ctx } = bundleShop();
    const info = (await bundleCardInfo(ctx, SET))!;
    const seen = new Set<string>();
    for (const l of SUPPORTED_LOCALES) {
      const text = bundleCardLines({ ...info, available: false }, l).join("\n");
      expect(text).toContain(BUNDLE_CARD[l].contains);
      expect(text).toContain(BUNDLE_CARD[l].unavailable);
      expect(text).toContain("• Шампунь × 2");
      seen.add(text);
    }
    expect(seen.size).toBe(4);
  });

  it("без выгоды строки выгоды нет", () => {
    const text = bundleCardLines(
      { parts: ["A × 1"], saving: null, available: true, capacity: null },
      "ru",
    );
    expect(text).toEqual(["В наборе:", "• A × 1"]);
  });
});
