import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Покупка сертификата на сайте целиком: заказ без товара → оплата → выдача
 * кода → страница заказа. Настоящие placeGiftOrder, deliverWebOrder и
 * webOrderView на подставной базе.
 */
const mails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("@/core/mail/mail.server", async (orig) => ({
  ...(await orig<typeof import("@/core/mail/mail.server")>()),
  isMailConfigured: () => true,
  smtpMailer: async (m: { to: string; subject: string; text: string }) => {
    mails.push(m);
    return { ok: true };
  },
}));
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  claimOrderPlacement: async () => true,
}));
vi.mock("@/core/payments/payment", async (orig) => ({
  robokassaReceipt: (await orig<typeof import("@/core/payments/payment")>()).robokassaReceipt,
  robokassaFor: async () => ({ ready: false }),
  stripeFor: async () => ({ ready: false }),
  prodamusFor: async () => ({ ready: false }),
}));

const { placeGiftOrder, giftSaleCountries } = await import("./gift-order");
const { deliverWebOrder, webCustomer, webOrderView } = await import("./web-order");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const ON = { gift_sale: { enabled: true, amounts: [5000, 10000], currency: "KZT" } };

function setup(settings: Record<string, unknown> = ON, modules = { gift_certificates: true }) {
  const db = fakeDb({
    unique: {
      app_settings: [["bot_id", "key"]],
      bot_users: [["user_key"]],
      gift_certificates: [["bot_id", "code"]],
    },
  });
  db.tables.bot_users = [];
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_name", value: "Прописи" }];
  db.tables.orders = [];
  db.tables.order_items = [];
  db.tables.gift_certificates = [];
  db.tables.zernio_logs = [];
  db.tables.payment_methods = [
    {
      id: "pm-kz",
      bot_id: BOT,
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Kaspi Gold 4400",
      is_active: true,
      sort_order: 0,
      qr_code_path: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "pm-ru",
      bot_id: BOT,
      country_code: "RU",
      country_name: "Россия",
      currency: "RUB",
      instructions: "Сбер",
      is_active: true,
      sort_order: 1,
      qr_code_path: null,
      created_at: new Date().toISOString(),
    },
  ];
  const ctx = {
    tenant: { id: BOT, name: "bot", modules, settings: { slug: "propisi", ...settings } },
    appUrl: "https://shop.test",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const contact = { name: "Анна", phone: null };

beforeEach(() => {
  mails.length = 0;
});

describe("покупка подарочного сертификата на сайте", () => {
  it("продажа выключена или модуля нет — заказ не создаётся", async () => {
    for (const { ctx, db } of [
      setup({}),
      setup({ gift_sale: { enabled: false, amounts: [5000] } }),
      setup(ON, { gift_certificates: false }),
    ]) {
      const c = await webCustomer(ctx, { email: "anna@mail.ru", ...contact });
      expect(await placeGiftOrder(ctx, c, 5000, "KZ", contact)).toEqual({
        ok: false,
        reason: "closed",
      });
      expect(db.tables.orders).toHaveLength(0);
    }
  });

  it("номинал не из списка продавца — отказ", async () => {
    const { ctx, db } = setup();
    const c = await webCustomer(ctx, { email: "anna@mail.ru", ...contact });
    expect(await placeGiftOrder(ctx, c, 7777, "KZ", contact)).toMatchObject({ reason: "amount" });
    expect(db.tables.orders).toHaveLength(0);
  });

  it("оплатить можно только в странах с валютой сертификата", async () => {
    const { ctx } = setup();
    expect(await giftSaleCountries(ctx)).toEqual([{ code: "KZ", name: "Казахстан" }]);
    const c = await webCustomer(ctx, { email: "anna@mail.ru", ...contact });
    expect(await placeGiftOrder(ctx, c, 5000, "RU", contact)).toMatchObject({
      reason: "country_unavailable",
    });
  });

  it("до оплаты кода нет; после оплаты — один код на странице заказа и письмом, без баллов", async () => {
    const { ctx, db } = setup();
    const c = await webCustomer(ctx, { email: "anna@mail.ru", ...contact });
    const r = await placeGiftOrder(ctx, c, 10000, "KZ", { name: "Анна", phone: "+77001234567" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountDue).toBe(10000);
    expect(db.tables.orders![0]).toMatchObject({
      platform: "web",
      status: "awaiting_payment",
      total: 10000,
      currency: "KZT",
      fulfillment_kind: "digital",
      customer_email: "anna@mail.ru",
      display_name: "Анна",
      contact: "+77001234567",
    });
    expect(db.tables.order_items).toEqual([
      expect.objectContaining({ product_id: null, quantity: 1, price_snapshot: 10000 }),
    ]);
    expect(String(db.tables.order_items![0]!.name_snapshot)).toMatch(/^Подарочный сертификат 10/);

    const before = await webOrderView(ctx, r.order.id);
    expect(before?.gift).toEqual({ amount: 10000, currency: "KZT", code: null });
    expect(db.tables.gift_certificates).toHaveLength(0);

    // Оплата подтверждена (колбэк Robokassa или продавец по чеку) — выдача.
    const d = await deliverWebOrder(ctx, r.order.id);
    expect(d).toMatchObject({ sent: 1, failed: 0, pointsEarned: 0 });
    expect(db.tables.orders![0]!.status).toBe("delivered");
    expect(db.tables.gift_certificates).toHaveLength(1);
    const code = String(db.tables.gift_certificates![0]!.code);
    expect(db.tables.gift_certificates![0]).toMatchObject({ amount: 10000, status: "active" });

    const after = await webOrderView(ctx, r.order.id);
    expect(after?.gift).toEqual({ amount: 10000, currency: "KZT", code });
    expect(after?.materials).toEqual([]);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("anna@mail.ru");
    expect(mails[0]!.text).toContain(code);
    expect(mails[0]!.text).toContain("https://shop.test/s/propisi");

    // Повторная выдача (продавец нажал «Выдать заново») — второго кода нет.
    db.tables.orders![0]!.status = "awaiting_confirmation";
    await deliverWebOrder(ctx, r.order.id);
    expect(db.tables.gift_certificates).toHaveLength(1);
    expect((await webOrderView(ctx, r.order.id))?.gift?.code).toBe(code);
  });

  it("покупка сертификата не награждает пригласившего: реферал остаётся ждать обычный заказ", async () => {
    const { ctx, db } = setup(ON, { gift_certificates: true, referral: true } as never);
    const c = await webCustomer(ctx, { email: "anna@mail.ru", ...contact });
    db.tables.referrals = [
      {
        id: "ref1",
        bot_id: BOT,
        referrer_telegram_id: 7,
        referred_telegram_id: c.telegramId,
        status: "pending",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const r = await placeGiftOrder(ctx, c, 5000, "KZ", contact);
    if (!r.ok) throw new Error("заказ не создан");
    db.tables.orders![0]!.created_at = "2026-09-27T10:00:00Z";
    await deliverWebOrder(ctx, r.order.id);
    expect(db.tables.orders![0]!.status).toBe("delivered");
    expect(db.tables.referrals![0]!.status).toBe("pending");
  });

  it("обычный заказ на странице — без блока сертификата", async () => {
    const { ctx, db } = setup();
    db.tables.orders!.push({
      id: 7,
      bot_id: BOT,
      order_no: 1,
      display_no: 1,
      platform: "web",
      status: "delivered",
      total: 100,
      currency: "KZT",
      fulfillment_kind: "digital",
      created_at: new Date().toISOString(),
    });
    db.tables.order_items!.push({
      id: "i1",
      order_id: 7,
      bot_id: BOT,
      product_id: "p1",
      name_snapshot: "Прописи",
      price_snapshot: 100,
      quantity: 1,
    });
    expect((await webOrderView(ctx, 7))?.gift).toBeNull();
  });
});
