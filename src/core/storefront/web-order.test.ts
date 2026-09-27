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

const {
  normalizeEmail,
  orderAccessToken,
  parseWebCheckout,
  placeWebOrder,
  verifyOrderAccess,
  webCustomer,
  webCardPaymentUrl,
  webCustomerId,
  webMaterialSender,
  webOrderView,
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
    expect(parseWebCheckout(null)).toEqual({ enabled: false });
    expect(parseWebCheckout("мусор")).toEqual({ enabled: false });
    expect(parseWebCheckout('{"enabled":true}')).toEqual({ enabled: true });
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
    expect(placeOrder).toHaveBeenCalledWith(ctx, customer, "KZ");
    expect(db.tables.cart_items!.map((c) => c.id)).toEqual(["new"]);
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

  it("заказ из бота по этой странице не открывается", async () => {
    const { ctx } = withOrder({ platform: "telegram" });
    expect(await webOrderView(ctx, 9)).toBeNull();
  });

  it("выдача на сайт не шлёт сообщений: материалы уже на странице", async () => {
    expect(await webMaterialSender({} as never, [])).toBe("sent");
  });
});
