import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, rejectOrder } from "@/core/orders/orders";
import { giftRestOf, issueGiftRest } from "./gift-rest";

/**
 * Остаток сертификата (решение владельца 27.09): сертификат больше заказа —
 * покупатель получает новый код на остаток в той же валюте. Отмена
 * неоплаченного заказа гасит остаток и возвращает исходный сертификат, но
 * только пока остатком не воспользовались.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

function setup(certAmount = 1000) {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      products: {
        id: "p-1",
        name: "Методичка",
        price: 500,
        currency: "KZT",
        fulfillment_kind: "digital",
        file_path: `${BOT}/m.pdf`,
      },
      product_variants: null,
    },
  ];
  db.tables.gift_certificates = [
    {
      id: "gift-1",
      bot_id: BOT,
      code: "GIFT-AAAA2222",
      amount: certAmount,
      currency: "KZT",
      status: "active",
      note: null,
      redeemed_by_telegram_id: null,
      redeemed_order_id: null,
      redeemed_at: null,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { gift_certificates: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

const certs = (db: ReturnType<typeof fakeDb>) => db.tables.gift_certificates!;

describe("остаток сертификата", () => {
  it("сертификат 1000 на заказ 500 — новый код на 500 с заметкой и меткой заказа", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: "gift-aaaa2222" });
    if (!r.ok) throw new Error(`не оформился: ${r.reason}`);
    expect(r.giftRest).toMatchObject({ amount: 500, currency: "KZT" });
    const rest = certs(db).find((c) => c.code === r.giftRest!.code);
    expect(rest).toMatchObject({ amount: 500, currency: "KZT", status: "active" });
    expect(String(rest!.note)).toContain("Остаток от GIFT-AAAA2222");
    expect(await giftRestOf(ctx, r.order.id)).toEqual(r.giftRest);
    expect(certs(db)[0]!.status).toBe("redeemed");
  });

  it("сертификат не больше заказа — остатка нет", async () => {
    const { db, ctx, customer } = setup(500);
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: "gift-aaaa2222" });
    if (!r.ok) throw new Error("не оформился");
    expect(r.giftRest).toBeNull();
    expect(certs(db)).toHaveLength(1);
    expect(await giftRestOf(ctx, r.order.id)).toBeNull();
  });

  it("отмена неоплаченного заказа: остаток погашен, исходный вернулся — один раз", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: "gift-aaaa2222" });
    if (!r.ok) throw new Error("не оформился");
    const res = await Promise.all([
      rejectOrder(ctx, r.order.id, "admin"),
      rejectOrder(ctx, r.order.id, "admin"),
    ]);
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(certs(db)[0]).toMatchObject({ status: "active", redeemed_order_id: null });
    expect(certs(db).find((c) => c.code === r.giftRest!.code)!.status).toBe("cancelled");
  });

  it("остатком уже заплатили — исходный сертификат при отмене не возвращается", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: "gift-aaaa2222" });
    if (!r.ok) throw new Error("не оформился");
    certs(db).find((c) => c.code === r.giftRest!.code)!.status = "redeemed";
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(certs(db)[0]!.status).toBe("redeemed");
    expect(certs(db).find((c) => c.code === r.giftRest!.code)!.status).toBe("redeemed");
  });

  it("оплаченный заказ отклонён — остаток остаётся у покупателя", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: "gift-aaaa2222" });
    if (!r.ok) throw new Error("не оформился");
    db.tables.orders![0]!.status = "awaiting_confirmation";
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(certs(db)[0]!.status).toBe("redeemed");
    expect(certs(db).find((c) => c.code === r.giftRest!.code)!.status).toBe("active");
  });

  it("код занят другим сертификатом — берётся следующий; повтор по заказу — та же метка", async () => {
    const { db, ctx } = setup();
    const codes = ["GIFT-AAAA2222", "GIFT-BBBB3333", "GIFT-CCCC4444"];
    const gen = () => codes.shift()!;
    const p = { orderId: 5, orderNo: 12, sourceCode: "GIFT-X", rest: 300, currency: "USD" };
    const a = await issueGiftRest(ctx, p, gen);
    expect(a).toEqual({ code: "GIFT-BBBB3333", amount: 300, currency: "USD" });
    const b = await issueGiftRest(ctx, p, gen);
    expect(b).toEqual(a);
    expect(certs(db).filter((c) => String(c.note).includes("№12"))).toHaveLength(1);
  });

  it("две выдачи по одному заказу сразу — один остаток", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.gift_certificates = [];
    const ctx = { tenant: { id: BOT, settings: {} }, db } as unknown as TenantContext;
    let n = 0;
    const gen = () => `GIFT-RACE${++n}`;
    const p = { orderId: 7, orderNo: 7, sourceCode: "GIFT-X", rest: 100, currency: "KZT" };
    const [a, b] = await Promise.all([issueGiftRest(ctx, p, gen), issueGiftRest(ctx, p, gen)]);
    expect(a).toEqual(b);
    expect(db.tables.gift_certificates).toHaveLength(1);
    expect(db.tables.gift_certificates![0]!.code).toBe(a!.code);
  });
});
