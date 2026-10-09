import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { resetPricingCache, setFxProvider } from "./pricing";
import { allCountryPrices, allPriceCountries, formatPriceList } from "./all-prices";

/** Палитра Копилки: основная 1700 ₸, для Казахстана 1500 ₸, для России 490 ₽. */
const palitra = { price: 1700, currency: "KZT", country_prices: { KZ: 1500, RU: 490 } };

type Method = { country_code: string; currency: string };

function tenant(
  methods: Method[],
  {
    setting = "true",
    multiCurrency = true,
  }: { setting?: string | null; multiCurrency?: boolean } = {},
): TenantContext {
  const db = fakeDb();
  db.tables.payment_methods = methods.map((m, i) => ({ ...m, sort_order: i, is_active: true }));
  db.tables.app_settings = setting === null ? [] : [{ key: "card_all_prices", value: setting }];
  return {
    tenant: { id: `t-all-${Math.random()}`, modules: { multi_currency: multiCurrency } },
    db,
  } as unknown as TenantContext;
}

const KZ = { country_code: "KZ", currency: "KZT" };
const RU = { country_code: "RU", currency: "RUB" };

beforeEach(() => {
  resetPricingCache();
  setFxProvider(async () => ({ USD: 1, KZT: 500, RUB: 80, KGS: 87, UZS: 12500 }));
});

describe("allPriceCountries", () => {
  it("Казахстан и Россия, настройка включена — обе страны по порядку способов оплаты", async () => {
    expect(await allPriceCountries(tenant([KZ, RU]))).toEqual(["KZ", "RU"]);
  });

  it("настройка выключена или не задана — одна цена", async () => {
    expect(await allPriceCountries(tenant([KZ, RU], { setting: "false" }))).toBeNull();
    expect(await allPriceCountries(tenant([KZ, RU], { setting: null }))).toBeNull();
  });

  it("без модуля мультивалютности — одна цена", async () => {
    expect(await allPriceCountries(tenant([KZ, RU], { multiCurrency: false }))).toBeNull();
  });

  it("одна валюта оплаты — показывать вторую нечего", async () => {
    expect(await allPriceCountries(tenant([KZ]))).toBeNull();
    // Две страны в тенге — всё равно одна валюта.
    expect(
      await allPriceCountries(tenant([KZ, { country_code: "XX", currency: "KZT" }])),
    ).toBeNull();
  });

  it("больше трёх валют — строка из пяти цен не читается, одна цена", async () => {
    const many = [
      KZ,
      RU,
      { country_code: "KG", currency: "KGS" },
      { country_code: "UZ", currency: "UZS" },
    ];
    expect(await allPriceCountries(tenant(many))).toBeNull();
  });
});

describe("allCountryPrices", () => {
  it("ручная цена каждой страны в её валюте: «1500 ₸ / 490 ₽»", async () => {
    const list = await allCountryPrices(tenant([KZ, RU]), palitra);
    expect(list).toEqual([
      { country: "KZ", price: { amount: 1500, currency: "KZT" }, old: null },
      { country: "RU", price: { amount: 490, currency: "RUB" }, old: null },
    ]);
    expect(formatPriceList(list!)).toBe("1500 ₸ / 490 ₽");
  });

  it("нет ручной цены для России — основная по курсу, как при выборе страны", async () => {
    const list = await allCountryPrices(tenant([KZ, RU]), {
      ...palitra,
      country_prices: { KZ: 1500 },
    });
    // 1700 ₸ / 500 × 80 = 272 ₽.
    expect(formatPriceList(list!)).toBe("1500 ₸ / 272 ₽");
  });

  it("с вариантами — самая низкая цена по каждой стране", async () => {
    const list = await allCountryPrices(tenant([KZ, RU]), palitra, [
      { price: 2500 },
      { price: 1000 },
    ]);
    // Варианты считаются от своей цены по курсу: 1000 ₸ и 160 ₽.
    expect(formatPriceList(list!)).toBe("1000 ₸ / 160 ₽");
  });
});
