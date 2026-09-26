import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { defaultFxProvider, resetPricingCache, setFxProvider } from "@/core/pricing/pricing";
import { zoneFee } from "./fulfillment";

/**
 * Комиссия зоны доставки хранится в домашней валюте продавца. В v1 она
 * показывалась и прибавлялась к сумме с ярлыком валюты ПОКУПАТЕЛЯ без самой
 * конвертации: покупатель из России платил «500 RUB» за зону «500 KZT».
 * Реквизиты: KZ — домашняя страна, RU — конвертируется, DE — реквизитов нет.
 */
const RATES = { USD: 1, KZT: 450, RUB: 72 };

function tenant(multiCurrency: boolean): TenantContext {
  const db = fakeDb();
  db.tables.payment_methods = [
    { country_code: "KZ", currency: "KZT", sort_order: 1, is_active: true },
    { country_code: "RU", currency: "RUB", sort_order: 2, is_active: true },
  ];
  return {
    tenant: { id: "t-zone-fee", modules: { multi_currency: multiCurrency } },
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

describe("zoneFee", () => {
  const ctx = tenant(true);

  it("для домашней страны продавца — без конвертации", async () => {
    expect(await zoneFee(ctx, 500, "KZ")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("для другой страны — конвертирует по курсу, а не просто меняет ярлык", async () => {
    expect(await zoneFee(ctx, 500, "RU")).toEqual({ amount: 80, currency: "RUB" });
  });

  it("страна ещё не выбрана — считает по домашней стране продавца", async () => {
    expect(await zoneFee(ctx, 500, null)).toEqual({ amount: 500, currency: "KZT" });
    expect(await zoneFee(ctx, 500, undefined)).toEqual({ amount: 500, currency: "KZT" });
  });

  it("страна без реквизитов — остаётся домашняя валюта, число не выдумывается", async () => {
    expect(await zoneFee(ctx, 500, "DE")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("курс недоступен — откатывается на домашнюю валюту", async () => {
    setFxProvider(() => Promise.reject(new Error("network down")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await zoneFee(ctx, 500, "RU")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("без модуля multi_currency — всегда домашняя валюта, независимо от страны", async () => {
    const off = tenant(false);
    expect(await zoneFee(off, 500, "RU")).toEqual({ amount: 500, currency: "KZT" });
    expect(await zoneFee(off, 500, "KZ")).toEqual({ amount: 500, currency: "KZT" });
  });
});
