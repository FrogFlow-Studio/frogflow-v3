import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { applyTemplateStatus } from "@/core/whatsapp/templates";
import { loadOfferState, resetOffersCache, OFFERS_KEY } from "@/core/offers/offers";
import { currencyForCountry, resetPricingCache } from "./pricing";

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

const ctxOf = (db: unknown) => ({ tenant: { id: BOT }, db }) as unknown as TenantContext;

beforeEach(() => {
  resetPricingCache();
  resetOffersCache();
});

describe("цены, акции, шаблоны: сбой чтения не равен «данных нет»", () => {
  it("способы оплаты: сбой не кэшируется как пустой список", async () => {
    const db = fakeDb();
    db.tables.payment_methods = [
      { country_code: "KZ", currency: "KZT", is_active: true, sort_order: 1 },
    ];
    await expect(
      currencyForCountry(ctxOf(breakTable(db, "payment_methods")), "KZ"),
    ).rejects.toThrow(/Способы оплаты/);
    // Сбой не осел в кэше: следующий вызов на здоровой базе видит валюту.
    expect(await currencyForCountry(ctxOf(db), "KZ")).toBe("KZT");
  });

  it("проданное по акции: сбой не превращается в «продано 0»", async () => {
    const db = fakeDb();
    const offer = {
      id: "o1",
      product_id: "p1",
      percent: 10,
      starts_at: "2020-01-01T00:00:00Z",
      ends_at: "2999-01-01T00:00:00Z",
      limit: 5,
    };
    db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify([offer]) }];
    await expect(loadOfferState(ctxOf(breakTable(db, "order_items")))).rejects.toThrow(/Продано/);
  });

  it("статус шаблона WhatsApp: сбой — ошибка, а не «шаблона нет»", async () => {
    const db = fakeDb();
    await expect(
      applyTemplateStatus(ctxOf(breakTable(db, "whatsapp_templates")), {
        accountId: "a",
        name: "n",
        language: "ru",
        status: "APPROVED",
      }),
    ).rejects.toThrow(/Статус шаблона/);
  });
});
