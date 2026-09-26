import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  convertForTenant,
  defaultFxProvider,
  resetPricingCache,
  resolveListPrice,
  setFxProvider,
} from "./pricing";

/**
 * Числа — из настоящего каталога и объяснения продавца (перенесено из v1
 * tests/pricing.test.ts): в основном поле завышенная цена (1000 ₸), в цене
 * для Казахстана — настоящая (800 ₸), остальные страны считаются по курсу.
 */
const product = { price: 1000, currency: "KZT", country_prices: { KZ: 800 } };
const plain = { price: 1000, currency: "KZT", country_prices: null };

/** Курс фиксированный, чтобы проверять правило, а не сегодняшнюю цифру: 1000 ₸ = 160 ₽. */
const RATES = { USD: 1, KZT: 450, RUB: 72 };

function tenant(multiCurrency: boolean): TenantContext {
  const db = fakeDb();
  // Реквизиты клиента: Казахстан первым (домашняя страна), дальше Россия и «прочие».
  db.tables.payment_methods = [
    { country_code: "KZ", currency: "KZT", sort_order: 1, is_active: true },
    { country_code: "RU", currency: "RUB", sort_order: 2, is_active: true },
    { country_code: "OTHER", currency: "USD", sort_order: 99, is_active: true },
  ];
  return {
    tenant: { id: "t-pricing", modules: { multi_currency: multiCurrency } },
    db,
  } as unknown as TenantContext;
}

beforeEach(() => {
  resetPricingCache();
  setFxProvider(async () => RATES);
});

afterEach(() => {
  setFxProvider(defaultFxProvider);
  vi.restoreAllMocks();
});

describe("resolveListPrice", () => {
  const ctx = tenant(true);

  it("для Казахстана берёт ручную цену, а не основную", async () => {
    expect(await resolveListPrice(ctx, product, "KZ")).toEqual({ amount: 800, currency: "KZT" });
  });

  it("для России считает по курсу и показывает рубли", async () => {
    // Живой случай v1: покупатель из России видел цену в тенге.
    expect(await resolveListPrice(ctx, product, "RU")).toEqual({ amount: 160, currency: "RUB" });
  });

  it("при неизвестной стране считает по домашней стране продавца, а не по завышенной основной", async () => {
    expect(await resolveListPrice(ctx, product, null)).toEqual({ amount: 800, currency: "KZT" });
    expect(await resolveListPrice(ctx, product, undefined)).toEqual({
      amount: 800,
      currency: "KZT",
    });
  });

  it("товар без цен по странам считается по курсу от основной", async () => {
    expect(await resolveListPrice(ctx, plain, "RU")).toEqual({ amount: 160, currency: "RUB" });
    expect(await resolveListPrice(ctx, plain, "KZ")).toEqual({ amount: 1000, currency: "KZT" });
  });

  it("страна без реквизитов не роняет расчёт: валюта товара, сумма не выдумывается", async () => {
    expect(await resolveListPrice(ctx, product, "DE")).toEqual({ amount: 1000, currency: "KZT" });
  });

  it("курс недоступен — откатывается на базовую цену в её валюте, а не на чужой ярлык", async () => {
    setFxProvider(() => Promise.reject(new Error("network down")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveListPrice(ctx, plain, "RU")).toEqual({ amount: 1000, currency: "KZT" });
  });

  describe("вариант товара", () => {
    const variant = { price: 500 };

    it("подставляет цену варианта вместо базовой products.price", async () => {
      expect(await resolveListPrice(ctx, plain, "KZ", variant)).toEqual({
        amount: 500,
        currency: "KZT",
      });
    });

    it("курс всё ещё применяется к цене варианта для другой страны", async () => {
      expect(await resolveListPrice(ctx, plain, "RU", variant)).toEqual({
        amount: 80,
        currency: "RUB",
      });
    });

    it("ручная цена страны для варианта не ищется — сознательный обход", async () => {
      // Без варианта было бы 800 (ручная цена KZ); с вариантом она игнорируется.
      expect(await resolveListPrice(ctx, product, "KZ", variant)).toEqual({
        amount: 500,
        currency: "KZT",
      });
    });

    it("без модуля multi_currency — тоже цена варианта, без конвертации", async () => {
      expect(await resolveListPrice(tenant(false), plain, "RU", variant)).toEqual({
        amount: 500,
        currency: "KZT",
      });
    });
  });
});

describe("resolveListPrice без модуля multi_currency", () => {
  it("игнорирует ручную цену страны и конвертацию — всегда база", async () => {
    const ctx = tenant(false);
    for (const code of ["KZ", "RU", "DE", null]) {
      expect(await resolveListPrice(ctx, product, code)).toEqual({
        amount: 1000,
        currency: "KZT",
      });
    }
  });
});

describe("convertForTenant", () => {
  it("одна и та же валюта — без похода за курсом, просто округляет", async () => {
    const provider = vi.fn(() => Promise.reject(new Error("не должно вызываться")));
    setFxProvider(provider);
    expect(await convertForTenant(1000.4, "KZT", "kzt")).toBe(1000);
    expect(provider).not.toHaveBeenCalled();
  });

  it("API курсов недоступен и курса в памяти ещё не было — null, а не исходное число", async () => {
    setFxProvider(() => Promise.reject(new Error("network down")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await convertForTenant(1000, "KZT", "RUB")).toBeNull();
  });

  describe("курс устарел, а API недоступен", () => {
    beforeEach(() => vi.useFakeTimers({ now: new Date("2026-09-26T10:00:00Z") }));
    afterEach(() => vi.useRealTimers());

    it("API недоступен, но есть кэш — считает по устаревшему курсу, не по null", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const provider = vi.fn(async () => ({ KZT: 500, RUB: 100 }));
      setFxProvider(provider);
      expect(await convertForTenant(1000, "KZT", "RUB")).toBe(200);

      vi.setSystemTime(new Date("2026-09-26T11:00:00Z")); // час спустя — TTL истёк
      provider.mockRejectedValue(new Error("network down"));
      expect(await convertForTenant(1000, "KZT", "RUB")).toBe(200);
      expect(provider).toHaveBeenCalledTimes(2);
    });

    it("после сбоя не долбит API на каждый запрос, а пробует снова через минуту", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const provider = vi.fn(async () => ({ KZT: 500, RUB: 100 }));
      setFxProvider(provider);
      await convertForTenant(1000, "KZT", "RUB");
      vi.setSystemTime(new Date("2026-09-26T11:00:00Z"));
      provider.mockRejectedValue(new Error("network down"));
      await convertForTenant(1000, "KZT", "RUB");
      await convertForTenant(1000, "KZT", "RUB");
      expect(provider).toHaveBeenCalledTimes(2);

      vi.setSystemTime(new Date("2026-09-26T11:01:01Z"));
      provider.mockResolvedValue({ KZT: 400, RUB: 100 });
      expect(await convertForTenant(1000, "KZT", "RUB")).toBe(250);
      expect(provider).toHaveBeenCalledTimes(3);
    });
  });
});
