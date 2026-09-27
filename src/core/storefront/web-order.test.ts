import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

const placeOrder = vi.fn();
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  placeOrder: (...a: unknown[]) => placeOrder(...a),
}));
const robokassa = vi.fn();
vi.mock("@/core/payments/payment", () => ({ robokassaFor: () => robokassa() }));
vi.mock("@/core/fulfillment/fulfillment", async (orig) => ({
  ...(await orig<typeof import("@/core/fulfillment/fulfillment")>()),
  amountDueNow: async (_c: unknown, o: { total: number }) => o.total,
}));
const importItems = vi.fn();
vi.mock("./handoff", () => ({ importItems: (...a: unknown[]) => importItems(...a) }));
vi.mock("@/config/env", () => ({
  env: () => ({ SESSION_SECRET: "test-secret-test-secret-test-secret-42" }),
}));

const {
  normalizeEmail,
  orderAccessToken,
  parseWebCheckout,
  placeWebOrder,
  verifyOrderAccess,
  telegramWebCustomer,
  webCustomer,
  webCardPaymentUrl,
  webCustomerId,
  webMaterialSender,
  webOrderView,
  orderPageUrl,
} = await import("./web-order");
const { claimCheckoutChallenge } = await import("./checkout-guard");
const { storefrontAllows } = await import("./access");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const SECRET = "test-secret-test-secret-test-secret-42";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]], bot_users: [["user_key"]] } });
  db.tables.bot_users = [];
  db.tables.cart_items = [];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: BOT, modules: { web_storefront: true, shop: true }, settings: {} },
    appUrl: "https://shop.test",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

beforeEach(() => {
  robokassa.mockReset();
  robokassa.mockResolvedValue({ ready: false });
  placeOrder.mockReset();
  importItems.mockReset();
});

describe("заказ с сайта: доступ и покупатель", () => {
  it("страница заказа открывается только по подписи своего заказа и магазина", () => {
    const t = orderAccessToken(SECRET, BOT, 42);
    expect(verifyOrderAccess(SECRET, BOT, 42, t)).toBe(true);
    expect(verifyOrderAccess(SECRET, BOT, 43, t)).toBe(false);
    expect(verifyOrderAccess(SECRET, "другой", 42, t)).toBe(false);
    expect(verifyOrderAccess("другой секрет", BOT, 42, t)).toBe(false);
    expect(verifyOrderAccess(SECRET, BOT, 42, "abc")).toBe(false);
  });

  it("почта проверяется и приводится к нижнему регистру", () => {
    expect(normalizeEmail("  Anna@Mail.RU ")).toBe("anna@mail.ru");
    expect(normalizeEmail("anna")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });

  it("повторный заказ с той же почтой — тот же покупатель, адрес не светится в ключе", async () => {
    const { db, ctx } = setup();
    const a = await webCustomer(ctx, { email: "anna@mail.ru", name: "Анна", phone: null });
    const b = await webCustomer(ctx, { email: "anna@mail.ru", name: "Анна К.", phone: "+7700" });
    expect(a.userKey).toBe(b.userKey);
    expect(a.userKey).toBe(`web_${webCustomerId("anna@mail.ru")}`);
    expect(a.userKey).not.toContain("anna");
    expect(a.platform).toBe("web");
    expect(a.telegramId).toBeLessThan(0);
    expect(db.tables.bot_users).toHaveLength(1);
    expect(db.tables.bot_users![0]).toMatchObject({ email: "anna@mail.ru", platform: "web" });
  });

  it("чужая почта не перезаписывает имя и телефон покупателя; контакты оформления — в заказе", async () => {
    const { db, ctx } = setup();
    const anna = await webCustomer(ctx, {
      email: "anna@mail.ru",
      name: "Анна",
      phone: "+77001112233",
    });
    const other = await webCustomer(ctx, {
      email: "anna@mail.ru",
      name: "Чужой",
      phone: "+79990000000",
    });
    expect(db.tables.bot_users![0]).toMatchObject({
      first_name: "Анна",
      contact_phone: "+77001112233",
    });
    db.tables.cart_items = [];
    db.tables.orders = [{ id: 7, bot_id: BOT, display_name: "Анна", contact: "+77001112233" }];
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "n",
        bot_id: BOT,
        telegram_id: anna.telegramId,
        products: { id: "p1", fulfillment_kind: "digital" },
      });
      return 1;
    });
    placeOrder.mockResolvedValue({ ok: true, order: { id: 7, display_name: "Анна" } });
    const r = await placeWebOrder(ctx, other, [{ product_id: "p1", quantity: 1 }], "KZ", {
      contact: { name: "Чужой", phone: "+79990000000" },
    });
    expect(r).toMatchObject({
      ok: true,
      order: { display_name: "Чужой", contact: "+79990000000" },
    });
    expect(db.tables.orders![0]).toMatchObject({ display_name: "Чужой", contact: "+79990000000" });
    expect(db.tables.bot_users![0]).toMatchObject({ first_name: "Анна" });
  });

  it("оформление на сайте выключено, пока продавец его не включил", () => {
    expect(parseWebCheckout(null)).toEqual({ enabled: false, tgLogin: false });
    expect(parseWebCheckout("мусор")).toEqual({ enabled: false, tgLogin: false });
    expect(parseWebCheckout('{"enabled":true}')).toEqual({ enabled: true, tgLogin: false });
    expect(parseWebCheckout('{"enabled":true,"tgLogin":true}')).toEqual({
      enabled: true,
      tgLogin: true,
    });
  });

  it("оформление на сайте — часть веб-витрины, не Mini App", () => {
    expect(storefrontAllows({ shop: true, web_storefront: true }, "web_checkout")).toBe(true);
    expect(storefrontAllows({ shop: true, telegram_mini_app: true }, "web_checkout")).toBe(false);
  });
});

describe("заказ с сайта: оформление", () => {
  const customer = { userKey: "web_x", telegramId: -5, platform: "web", state: {} } as Customer;

  it("идёт через тот же placeOrder, что в боте; старая корзина покупателя очищается", async () => {
    const { db, ctx } = setup();
    db.tables.cart_items = [{ id: "old", bot_id: BOT, telegram_id: -5, product_id: "p0" }];
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "new",
        bot_id: BOT,
        telegram_id: -5,
        product_id: "p1",
        products: { id: "p1", fulfillment_kind: "digital" },
      });
      return 1;
    });
    placeOrder.mockResolvedValue({ ok: true, order: { id: 7 } });
    const r = await placeWebOrder(ctx, customer, [{ product_id: "p1", quantity: 1 }], "KZ");
    expect(r).toMatchObject({ ok: true });
    expect(placeOrder).toHaveBeenCalledWith(ctx, customer, "KZ", {});
    expect(db.tables.cart_items!.map((c) => c.id)).toEqual(["new"]);
  });

  it("промокод и сертификат уходят в тот же placeOrder, баллы на сайте не списываются", async () => {
    const { db, ctx } = setup();
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "new",
        bot_id: BOT,
        telegram_id: -5,
        products: { id: "p1", fulfillment_kind: "digital" },
      });
      return 1;
    });
    placeOrder.mockResolvedValue({ ok: false, reason: "promo_invalid" });
    const r = await placeWebOrder(ctx, customer, [{ product_id: "p1", quantity: 1 }], "KZ", {
      promoCode: " spring10 ",
      giftCode: "GIFT-ABCD",
    });
    expect(r).toEqual({ ok: false, reason: "promo_invalid" });
    expect(placeOrder).toHaveBeenCalledWith(ctx, customer, "KZ", {
      promoCode: "spring10",
      giftCode: "GIFT-ABCD",
    });
    expect(placeOrder.mock.calls[0]![3]).not.toHaveProperty("usePoints");
  });

  it("физический заказ: коды скидки идут вместе с выбором получения", async () => {
    const { db, ctx } = setup();
    db.tables.payment_methods = [];
    db.tables.delivery_zones = [];
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "cake",
        bot_id: BOT,
        telegram_id: -5,
        products: { id: "cake", fulfillment_kind: "physical", lead_time_days: 0 },
      });
      return 1;
    });
    placeOrder.mockResolvedValue({ ok: true, order: { id: 8 } });
    await placeWebOrder(ctx, customer, [{ product_id: "cake", quantity: 1 }], "KZ", {
      fulfillment: { type: "pickup", date: "2099-01-10" },
      giftCode: "GIFT-ABCD",
      promoCode: "  ",
    });
    expect(placeOrder).toHaveBeenCalledWith(ctx, customer, "KZ", {
      giftCode: "GIFT-ABCD",
      fulfillment: { type: "pickup", at: "2099-01-10", address: null, note: null, zone: null },
    });
  });

  it("физические товары: выбор получения проверяется до placeOrder и уходит в заказ", async () => {
    const { db, ctx } = setup();
    db.tables.payment_methods = [];
    db.tables.delivery_zones = [];
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "cake",
        bot_id: BOT,
        telegram_id: -5,
        products: { id: "cake", fulfillment_kind: "physical", lead_time_days: 0 },
      });
      return 1;
    });
    placeOrder.mockResolvedValue({ ok: true, order: { id: 8 } });
    const date = "2099-01-10";
    const r = await placeWebOrder(ctx, customer, [{ product_id: "cake", quantity: 1 }], "KZ", {
      fulfillment: { type: "pickup", date },
    });
    expect(r).toMatchObject({ ok: true });
    expect(placeOrder).toHaveBeenCalledWith(ctx, customer, "KZ", {
      fulfillment: { type: "pickup", at: date, address: null, note: null, zone: null },
    });
  });

  it("физические товары без выбора получения — отказ, корзина не остаётся", async () => {
    const { db, ctx } = setup();
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "cake",
        bot_id: BOT,
        telegram_id: -5,
        products: { id: "cake", fulfillment_kind: "physical" },
      });
      return 1;
    });
    const r = await placeWebOrder(ctx, customer, [{ product_id: "cake", quantity: 1 }], "KZ");
    expect(r).toEqual({ ok: false, reason: "missing" });
    expect(placeOrder).not.toHaveBeenCalled();
    expect(db.tables.cart_items).toHaveLength(0);
  });

  it("ничего не легло в корзину — заказа нет", async () => {
    const { ctx } = setup();
    importItems.mockResolvedValue(0);
    expect(await placeWebOrder(ctx, customer, [{ product_id: "x", quantity: 1 }], "KZ")).toEqual({
      ok: false,
      reason: "nothing_imported",
    });
  });

  it("одно решение задачи против ботов оформляет только один заказ", async () => {
    const { ctx } = setup();
    const [a, b] = await Promise.all([
      claimCheckoutChallenge(ctx, "nonce1"),
      claimCheckoutChallenge(ctx, "nonce1"),
    ]);
    expect([a, b].sort()).toEqual(["ok", "used"]);
    expect(await claimCheckoutChallenge(ctx, "nonce2")).toBe("ok");
  });
});

describe("заказ с сайта после входа через Telegram", () => {
  const tgRow = (extra: Record<string, unknown> = {}) => ({
    bot_id: BOT,
    user_key: "tg_42",
    telegram_id: 42,
    platform: "telegram",
    first_name: "Анна",
    email: null,
    ...extra,
  });

  it("покупатель — тот же, что в боте, канал заказа — сайт, почта записана", async () => {
    const { db, ctx } = setup();
    db.tables.bot_users = [tgRow()];
    const c = await telegramWebCustomer(ctx, 42, "anna@example.com");
    expect(c).toMatchObject({ userKey: "tg_42", telegramId: 42, platform: "web" });
    expect(c!.email).toBe("anna@example.com");
    expect(db.tables.bot_users![0]!.email).toBe("anna@example.com");
  });

  it("нет такого покупателя в боте — null, оформление пойдёт по почте", async () => {
    const { db, ctx } = setup();
    expect(await telegramWebCustomer(ctx, 42, "a@b.cd")).toBeNull();
    // Строка покупателя сайта с тем же числом в telegram_id — не он.
    db.tables.bot_users = [tgRow({ user_key: "web_42", platform: "web" })];
    expect(await telegramWebCustomer(ctx, 42, "a@b.cd")).toBeNull();
  });

  it("корзина покупателя в боте после заказа с сайта возвращается как была", async () => {
    const { db, ctx } = setup();
    db.tables.cart_items = [
      {
        id: "bot-1",
        bot_id: BOT,
        telegram_id: 42,
        user_key: "tg_42",
        product_id: "p-bot",
        product_variant_id: null,
        quantity: 2,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    importItems.mockImplementation(async () => {
      db.tables.cart_items!.push({
        id: "site",
        bot_id: BOT,
        telegram_id: 42,
        product_id: "p-site",
        products: { id: "p-site", fulfillment_kind: "digital" },
      });
      return 1;
    });
    // placeOrder, как настоящий, очищает корзину после заказа.
    placeOrder.mockImplementation(async () => {
      db.tables.cart_items = [];
      return { ok: true, order: { id: 9 } };
    });
    const customer = {
      userKey: "tg_42",
      telegramId: 42,
      platform: "web",
      state: {},
    } as Customer;
    const r = await placeWebOrder(ctx, customer, [{ product_id: "p-site", quantity: 1 }], "KZ");
    expect(r).toMatchObject({ ok: true });
    expect(
      db.tables.cart_items!.map((c) => [c.product_id, c.quantity, c.user_key, c.telegram_id]),
    ).toEqual([["p-bot", 2, "tg_42", 42]]);
  });

  it("баллы за заказ вошедшего покупателя — на его счёт в боте, не на счёт почты", async () => {
    const { db, ctx } = setup();
    (ctx.tenant.modules as Record<string, boolean>).loyalty = true;
    db.tables.bot_users = [
      tgRow({ loyalty_points: 100 }),
      {
        bot_id: BOT,
        user_key: "web_x",
        telegram_id: -7,
        platform: "web",
        email: "anna@example.com",
        loyalty_points: 0,
      },
    ];
    importItems.mockResolvedValue(1);
    placeOrder.mockImplementation(async (_ctx: unknown, c: Customer) => {
      db.tables.orders = [
        {
          id: 9,
          bot_id: BOT,
          telegram_id: c.telegramId,
          user_key: c.userKey,
          total: 2000,
          points_earned: 0,
        },
      ];
      return { ok: true, order: db.tables.orders[0] };
    });
    const customer = await telegramWebCustomer(ctx, 42, "anna@example.com");
    const r = await placeWebOrder(ctx, customer!, [{ product_id: "p", quantity: 1 }], "KZ");
    expect(r).toMatchObject({ ok: true });
    const order = db.tables.orders![0]!;
    expect(order).toMatchObject({ telegram_id: 42, user_key: "tg_42" });
    const { awardPointsForOrder } = await import("@/core/discounts/discounts");
    expect(await awardPointsForOrder(ctx, 9, Number(order.telegram_id), 2000)).toBe(100);
    const points = Object.fromEntries(
      db.tables.bot_users!.map((u) => [u.user_key, u.loyalty_points]),
    );
    expect(points).toEqual({ tg_42: 200, web_x: 0 });
  });

  it("корзина бота возвращается и когда оформление не удалось", async () => {
    const { db, ctx } = setup();
    db.tables.cart_items = [
      { id: "bot-1", bot_id: BOT, telegram_id: 42, product_id: "p-bot", quantity: 1 },
    ];
    importItems.mockResolvedValue(0);
    const customer = { userKey: "tg_42", telegramId: 42, platform: "web", state: {} } as Customer;
    const r = await placeWebOrder(ctx, customer, [{ product_id: "gone", quantity: 1 }], "KZ");
    expect(r).toEqual({ ok: false, reason: "nothing_imported" });
    expect(db.tables.cart_items!.map((c) => c.product_id)).toEqual(["p-bot"]);
  });
});

describe("заказ с сайта: страница заказа", () => {
  function withOrder(over: Record<string, unknown> = {}) {
    const s = setup();
    s.db.tables.orders = [
      {
        id: 9,
        bot_id: BOT,
        order_no: 9,
        display_no: 109,
        platform: "web",
        status: "awaiting_payment",
        total: 2500,
        currency: "KZT",
        country_code: "KZ",
        fulfillment_kind: "digital",
        customer_email: "anna@mail.ru",
        created_at: "2026-09-27T06:00:00Z",
        // Встроенный join PostgREST: позиции приходят вместе с заказом.
        order_items: [
          { id: "i1", order_id: 9, name_snapshot: "Прописи", quantity: 1, price_snapshot: 2500 },
        ],
        ...over,
      },
    ];
    s.db.tables.payment_methods = [
      {
        id: "pm",
        bot_id: BOT,
        country_code: "KZ",
        country_name: "Казахстан",
        is_active: true,
        sort_order: 0,
        instructions: "Kaspi: pay.kaspi.kz/pay/xyz",
        qr_code_path: "qr/kaspi.png",
      },
    ];
    return s;
  }

  it("неоплаченный заказ: сумма, реквизиты и QR способа оплаты страны заказа", async () => {
    const { ctx } = withOrder();
    const v = await webOrderView(ctx, 9);
    expect(v).toMatchObject({
      no: 109,
      status: "awaiting_payment",
      total: 2500,
      items: [{ name: "Прописи", qty: 1, price: 2500 }],
      payment: { instructions: "Kaspi: pay.kaspi.kz/pay/xyz" },
      materials: [],
    });
    expect(v!.payment!.qr).toMatch(/^https:\/\/shop\.test\/api\/img\/.+/);
    expect(v!.discount).toBe(0);
  });

  it("скидка промокодом, баллами и сертификатом видна вместе; к оплате — уже после неё", async () => {
    const { ctx } = withOrder({
      total: 1700,
      discount_amount: 500,
      points_used: 0,
      gift_certificate_discount: 300,
    });
    const v = await webOrderView(ctx, 9);
    expect(v).toMatchObject({ total: 1700, due: 1700, discount: 800 });
  });

  it("Robokassa продавца подключена — есть оплата картой на сумму заказа", async () => {
    const { ctx } = withOrder();
    robokassa.mockResolvedValue({
      ready: true,
      login: "L",
      pass1: "a",
      pass2: "b",
      testMode: false,
    });
    expect((await webOrderView(ctx, 9))!.payment!.card).toBe(true);
    const url = new URL((await webCardPaymentUrl(ctx, 9))!);
    expect(url.searchParams.get("InvId")).toBe("9");
    expect(url.searchParams.get("OutSum")).toBe("2500.00");
    expect(url.searchParams.get("MerchantLogin")).toBe("L");
  });

  it("без Robokassa оплаты картой нет; оплаченный заказ картой не оплатить", async () => {
    const { ctx } = withOrder();
    expect((await webOrderView(ctx, 9))!.payment!.card).toBe(false);
    expect(await webCardPaymentUrl(ctx, 9)).toBeNull();
    const paid = withOrder({ status: "paid" });
    robokassa.mockResolvedValue({
      ready: true,
      login: "L",
      pass1: "a",
      pass2: "b",
      testMode: false,
    });
    expect(await webCardPaymentUrl(paid.ctx, 9)).toBeNull();
  });

  it("чек на проверке — реквизиты больше не показываются", async () => {
    const { ctx } = withOrder({ status: "awaiting_confirmation" });
    expect((await webOrderView(ctx, 9))!.payment).toBeNull();
  });

  const rkOn = () =>
    robokassa.mockResolvedValue({
      ready: true,
      login: "L",
      pass1: "a",
      pass2: "b",
      testMode: false,
    });
  const inWork = (over: Record<string, unknown> = {}) =>
    withOrder({
      status: "in_production",
      fulfillment_kind: "physical",
      total: 10000,
      paid_amount: 3000,
      ...over,
    });

  it("задаток внесён, заказ в работе — «оплатить остаток»: сумма с сервера, карта и реквизиты", async () => {
    const { ctx } = inWork();
    rkOn();
    const v = (await webOrderView(ctx, 9))!;
    expect(v.payment).toBeNull();
    expect(v.balance).toMatchObject({
      due: 7000,
      paid: 3000,
      card: true,
      instructions: "Kaspi: pay.kaspi.kz/pay/xyz",
    });
    expect(v.balancePending).toBe(false);
    const url = new URL((await webCardPaymentUrl(ctx, 9))!);
    expect(url.searchParams.get("InvId")).toBe("1000000000090000");
    expect(url.searchParams.get("OutSum")).toBe("7000.00");
    expect(url.searchParams.get("Description")).toContain("Остаток");
  });

  it("чек на остаток у продавца — оплатить ещё раз нельзя, на странице «на проверке»", async () => {
    const { db, ctx } = inWork();
    rkOn();
    db.tables.zernio_logs = [
      {
        id: "e1",
        bot_id: BOT,
        event_id: "order:9:balance_proof:300000:0",
        event_type: "order.balance_proof",
        status: "event",
        payload: { order_id: 9 },
        created_at: "2026-09-27T07:00:00Z",
      },
    ];
    const v = (await webOrderView(ctx, 9))!;
    expect(v.balance).toBeNull();
    expect(v.balancePending).toBe(true);
    expect(await webCardPaymentUrl(ctx, 9)).toBeNull();
  });

  it("остатка нет: всё внесено, оплата при получении, цифровой, ещё не принят", async () => {
    for (const over of [
      { paid_amount: 10000 },
      { paid_amount: 0 },
      { fulfillment_kind: "digital" },
      { status: "delivered" },
    ]) {
      const { ctx } = inWork(over);
      rkOn();
      expect((await webOrderView(ctx, 9))!.balance).toBeNull();
      expect(await webCardPaymentUrl(ctx, 9)).toBeNull();
    }
  });

  it("ни карты, ни реквизитов — кнопки нет, остаток платят при получении", async () => {
    const { db, ctx } = inWork();
    db.tables.payment_methods = [];
    expect((await webOrderView(ctx, 9))!.balance).toBeNull();
  });

  it("заказ из бота по этой странице не открывается", async () => {
    const { ctx } = withOrder({ platform: "telegram" });
    expect(await webOrderView(ctx, 9)).toBeNull();
  });

  it("счёт ссылкой из Instagram/WhatsApp открывается, как заказ с сайта", async () => {
    for (const platform of ["instagram", "whatsapp"]) {
      const { ctx, db } = withOrder({ platform });
      db.tables.app_settings!.push({ bot_id: BOT, key: "invoice_link:9", value: "1" });
      expect(await webOrderView(ctx, 9)).toMatchObject({ no: 109, status: "awaiting_payment" });
    }
  });

  it("заказ из Telegram страницей на сайте не открывается", async () => {
    const { ctx } = withOrder({ platform: "telegram" });
    expect(await webOrderView(ctx, 9)).toBeNull();
    expect(await webCardPaymentUrl(ctx, 9)).toBeNull();
  });

  it("обычный заказ из Instagram/WhatsApp: страница показывает заказ, но оплатить на ней нельзя", async () => {
    for (const platform of ["instagram", "whatsapp"]) {
      const { ctx } = withOrder({ platform });
      const v = await webOrderView(ctx, 9);
      expect(v).toMatchObject({ id: 9, no: 109, payment: null, due: 0 });
      expect(await webCardPaymentUrl(ctx, 9)).toBeNull();
    }
  });

  it("выдача на сайт не шлёт сообщений: материалы уже на странице", async () => {
    expect(await webMaterialSender({} as never, [])).toBe("sent");
  });
});

describe("ссылка на страницу заказа", () => {
  const ctxOf = (modules: Record<string, boolean>, settings: Record<string, unknown>) =>
    ({
      tenant: { id: BOT, archived: false, modules, settings },
      appUrl: "https://app.test",
    }) as unknown as TenantContext;

  it("магазин без витрины и юр. страниц: ссылка есть, и её страница открывается", async () => {
    const url = await orderPageUrl(ctxOf({ shop: true }, { served_by: "v2", slug: "bovi" }), 7);
    expect(url).toMatch(/^https:\/\/app\.test\/s\/bovi\/order\/7\?t=/);
    const t = new URL(url!).searchParams.get("t")!;
    expect(verifyOrderAccess(SECRET, BOT, 7, t)).toBe(true);
  });

  it("без магазина, на v1 или без адреса — ссылки нет (выдача не считается отправленной)", async () => {
    expect(await orderPageUrl(ctxOf({}, { served_by: "v2", slug: "bovi" }), 7)).toBeNull();
    expect(
      await orderPageUrl(ctxOf({ shop: true }, { served_by: "v1", slug: "bovi" }), 7),
    ).toBeNull();
    expect(await orderPageUrl(ctxOf({ shop: true }, { served_by: "v2" }), 7)).toBeNull();
  });
});
