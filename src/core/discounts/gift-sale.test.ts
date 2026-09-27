import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  GIFT_SALE_PREFIX,
  giftSaleOf,
  giftSaleOpen,
  giftSaleSettings,
  issueGiftForOrder,
  markGiftSale,
  normalizeGiftAmounts,
} from "./gift-sale";

const BOT = "00000000-0000-0000-0000-0000000000aa";

function setup(settings: Record<string, unknown> = {}, modules = { gift_certificates: true }) {
  const db = fakeDb({
    unique: { app_settings: [["bot_id", "key"]], gift_certificates: [["bot_id", "code"]] },
  });
  db.tables.app_settings = [];
  db.tables.gift_certificates = [];
  const ctx = { tenant: { id: BOT, modules, settings }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("настройка продажи сертификатов", () => {
  it("по умолчанию выключено", () => {
    expect(giftSaleOpen(setup().ctx)).toBe(false);
    expect(giftSaleSettings(setup().ctx)).toEqual({ enabled: false, amounts: [], currency: "KZT" });
  });

  it("открыта при модуле, включённой настройке и хотя бы одном номинале", () => {
    const on = { gift_sale: { enabled: true, amounts: [5000] } };
    expect(giftSaleOpen(setup(on).ctx)).toBe(true);
    expect(giftSaleOpen(setup({ gift_sale: { enabled: true, amounts: [] } }).ctx)).toBe(false);
    expect(giftSaleOpen(setup(on, { gift_certificates: false }).ctx)).toBe(false);
  });

  it("номиналы: целые положительные, без повторов, по возрастанию, не больше шести", () => {
    expect(normalizeGiftAmounts([10000, 5000, 5000, -1, 0, 2.5, "x", 3000])).toEqual([
      3000, 5000, 10000,
    ]);
    expect(normalizeGiftAmounts([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(6);
    expect(normalizeGiftAmounts("5000")).toEqual([]);
  });
});

describe("выдача кода по оплаченному заказу", () => {
  const order = { id: 42, display_no: 501 };

  it("обычный заказ — не сертификат, ничего не создаётся", async () => {
    const { db, ctx } = setup();
    expect(await giftSaleOf(ctx, 42)).toBeNull();
    expect(await issueGiftForOrder(ctx, order)).toBeNull();
    expect(db.tables.gift_certificates).toHaveLength(0);
  });

  it("до оплаты кода нет; при выдаче — активный сертификат на номинал заказа", async () => {
    const { db, ctx } = setup();
    await markGiftSale(ctx, 42, { amount: 10000, currency: "KZT" });
    expect(await giftSaleOf(ctx, 42)).toEqual({ amount: 10000, currency: "KZT" });
    expect(db.tables.gift_certificates).toHaveLength(0);

    const g = await issueGiftForOrder(ctx, order);
    expect(g).toEqual({
      code: expect.stringMatching(/^GIFT-[A-Z2-9]{8}$/),
      amount: 10000,
      currency: "KZT",
    });
    expect(db.tables.gift_certificates).toEqual([
      expect.objectContaining({
        bot_id: BOT,
        code: g!.code,
        amount: 10000,
        currency: "KZT",
        status: "active",
        note: "Куплен на сайте, заказ №501",
      }),
    ]);
    expect((await giftSaleOf(ctx, 42))?.code).toBe(g!.code);
  });

  it("повторная выдача возвращает тот же код, второго сертификата нет", async () => {
    const { db, ctx } = setup();
    await markGiftSale(ctx, 42, { amount: 5000, currency: "KZT" });
    const a = await issueGiftForOrder(ctx, order);
    const b = await issueGiftForOrder(ctx, order);
    expect(b).toEqual(a);
    expect(db.tables.gift_certificates).toHaveLength(1);
  });

  it("две выдачи одновременно — один код на обе", async () => {
    const { db, ctx } = setup();
    await markGiftSale(ctx, 42, { amount: 5000, currency: "KZT" });
    let n = 0;
    const gen = () => `GIFT-RACE000${++n}`;
    const [a, b] = await Promise.all([
      issueGiftForOrder(ctx, order, gen),
      issueGiftForOrder(ctx, order, gen),
    ]);
    expect(a).toEqual(b);
    expect(db.tables.gift_certificates).toHaveLength(1);
    expect(db.tables.gift_certificates![0]!.code).toBe(a!.code);
  });

  it("код уже занят другим сертификатом магазина — берётся другой", async () => {
    const { db, ctx } = setup();
    db.tables.gift_certificates!.push({
      id: "g1",
      bot_id: BOT,
      code: "GIFT-TAKEN111",
      amount: 999,
      currency: "KZT",
      note: "выдан вручную",
      status: "active",
      created_at: new Date().toISOString(),
    });
    await markGiftSale(ctx, 42, { amount: 5000, currency: "KZT" });
    const codes = ["GIFT-TAKEN111", "GIFT-FRESH222"];
    const g = await issueGiftForOrder(ctx, order, () => codes.shift()!);
    expect(g?.code).toBe("GIFT-FRESH222");
    expect(db.tables.gift_certificates!.map((r) => [r.code, r.amount])).toEqual([
      ["GIFT-TAKEN111", 999],
      ["GIFT-FRESH222", 5000],
    ]);
  });

  it("метка чужого магазина не читается", async () => {
    const { db, ctx } = setup();
    db.tables.app_settings!.push({
      bot_id: "other",
      key: `${GIFT_SALE_PREFIX}42`,
      value: JSON.stringify({ amount: 5000, currency: "KZT" }),
      updated_at: new Date().toISOString(),
    });
    expect(await issueGiftForOrder(ctx, order)).toBeNull();
  });
});
