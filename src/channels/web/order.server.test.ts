import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Чек с сайта: те же исходы, что у чека из Instagram/WhatsApp, только ответ
 * покупателю — исход для страницы заказа, а не сообщение.
 */
const attach = vi.fn();
const markVerified = vi.fn();
const deliver = vi.fn();
const verify = vi.fn();
const autoOn = vi.fn();
const notifyNew = vi.fn();
const notifyFail = vi.fn();
const coreDeliver = vi.fn();
const zernioCopy = vi.fn();
let current: unknown = null;
const attachBalance = vi.fn();
const notifyAdmins = vi.fn();
vi.mock("@/core/orders/balance", () => ({
  attachBalanceProof: (...a: unknown[]) => attachBalance(...a),
}));
let zernioTarget: unknown = { conversationId: "c", accountId: "a", platform: "instagram" };

vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  attachPaymentProof: (...a: unknown[]) => attach(...a),
  markProofVerified: (...a: unknown[]) => markVerified(...a),
  getOrder: async () => current,
  deliverOrder: (...a: unknown[]) => coreDeliver(...a),
}));
vi.mock("@/channels/zernio/outbound.server", () => ({
  zernioTargetForOrder: async () => zernioTarget,
  zernioSenderFor:
    () =>
    (...a: unknown[]) =>
      zernioCopy(...a),
}));
vi.mock("@/core/storefront/web-order", () => ({
  deliverWebOrder: (...a: unknown[]) => deliver(...a),
}));
vi.mock("@/core/receipts/verify.server", () => ({
  receiptOcrAutoEnabled: () => autoOn(),
  verifyCustomerReceipt: (...a: unknown[]) => verify(...a),
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomer: async () => ({ userKey: "web_x", telegramId: -5, platform: "web", state: {} }),
}));
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({}),
  notifyAdminsHtml: (...a: unknown[]) => notifyAdmins(...a),
  notifyDeliveryFailure: (...a: unknown[]) => notifyFail(...a),
}));
vi.mock("@/channels/telegram/admin-notify", () => ({
  notifyAdminNewOrder: (...a: unknown[]) => notifyNew(...a),
}));

const { afterWebOrderPlaced, receiveWebProof } = await import("./order.server");

const BOT = "00000000-0000-0000-0000-0000000000bb";
const ORDER = {
  id: 9,
  display_no: 109,
  order_no: 9,
  user_key: "web_x",
  total: 2500,
  currency: "KZT",
  fulfillment_kind: "digital",
  platform: "web",
  status: "awaiting_confirmation",
};

function setup() {
  const db = fakeDb();
  db.tables.orders = [{ ...ORDER }];
  return {
    db,
    ctx: { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext,
  };
}

const file = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" };

beforeEach(() => {
  for (const f of [
    attach,
    markVerified,
    deliver,
    verify,
    autoOn,
    notifyNew,
    notifyFail,
    coreDeliver,
    zernioCopy,
    attachBalance,
    notifyAdmins,
  ])
    f.mockReset();
  current = null;
  attachBalance.mockResolvedValue(null);
  notifyAdmins.mockResolvedValue(1);
  zernioCopy.mockResolvedValue("sent");
  attach.mockResolvedValue({ ok: true, order: { ...ORDER }, hash: "h" });
  deliver.mockResolvedValue({ sent: 1, failed: 0, pending: 0 });
  markVerified.mockResolvedValue(true);
  notifyNew.mockResolvedValue(undefined);
  notifyFail.mockResolvedValue(0);
});

describe("чек на остаток по задатку", () => {
  const inWork = { ...ORDER, status: "in_production", fulfillment_kind: "physical" };

  it("заказ в работе с остатком — чек на остаток, продавцу сообщение; обычный путь не трогается", async () => {
    const { ctx } = setup();
    current = inWork;
    attachBalance.mockResolvedValue({ ok: true, due: 7000, path: "p" });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "balance" });
    expect(attach).not.toHaveBeenCalled();
    expect(notifyAdmins).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining("чек на остаток"),
      expect.objectContaining({ orderId: 9 }),
    );
  });

  it("второй чек на остаток — отказ «уже был», без сообщения продавцу", async () => {
    const { ctx } = setup();
    current = inWork;
    attachBalance.mockResolvedValue({ ok: false, reason: "duplicate" });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: false, reason: "duplicate" });
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("остатка нет — обычный чек заказа", async () => {
    const { ctx } = setup();
    current = { ...ORDER, status: "awaiting_payment" };
    await receiveWebProof(ctx, 9, file);
    expect(attach).toHaveBeenCalled();
  });
});

describe("чек с сайта", () => {
  it("без автопроверки — продавцу на проверку", async () => {
    const { ctx } = setup();
    autoOn.mockResolvedValue(false);
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "review" });
    expect(notifyNew).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("чек совпал — заказ выдан на страницу, продавцу «выдано автоматически»", async () => {
    const { ctx } = setup();
    autoOn.mockResolvedValue(true);
    verify.mockResolvedValue({ result: { ok: true, matchedAmount: 2500 } });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "delivered" });
    expect(deliver).toHaveBeenCalledWith(ctx, 9);
    expect(notifyNew.mock.calls[0]![4]).toEqual({ autoDelivered: true });
  });

  it("счёт ссылкой из Instagram: чек совпал — выдача на страницу заказа, в диалог копия", async () => {
    const { ctx } = setup();
    autoOn.mockResolvedValue(true);
    attach.mockResolvedValue({ ok: true, order: { ...ORDER, platform: "instagram" }, hash: "h" });
    verify.mockResolvedValue({ result: { ok: true, matchedAmount: 2500 } });
    coreDeliver.mockImplementation(async (_c, _id, send) => {
      await send({ name_snapshot: "Прописи" }, [{ path: "x.pdf" }]);
      return { sent: 1, failed: 0, pending: 0 };
    });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "delivered" });
    expect(coreDeliver).toHaveBeenCalledWith(ctx, 9, expect.any(Function), {
      lang: "ru",
      allWhenAmbiguous: true,
    });
    expect(zernioCopy).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("счёт ссылкой: окно Instagram закрыто или диалога нет — заказ всё равно выдан на странице", async () => {
    const { invoiceLinkSender } = await import("./order.server");
    const { ctx } = setup();
    zernioCopy.mockRejectedValue(new Error("24h window closed"));
    const send = await invoiceLinkSender(ctx, {
      user_key: "ig_1",
      telegram_id: -7,
      platform: "instagram",
    });
    expect(await send({ name_snapshot: "Прописи" } as never, [])).toBe("sent");
    zernioTarget = null;
    const noDialog = await invoiceLinkSender(ctx, {
      user_key: "ig_1",
      telegram_id: -7,
      platform: "instagram",
    });
    expect(await noDialog({ name_snapshot: "Прописи" } as never, [])).toBe("sent");
    zernioTarget = { conversationId: "c", accountId: "a", platform: "instagram" };
  });

  it("не чек — можно загрузить другой, заказ снова ждёт оплаты, продавца не дёргаем", async () => {
    const { ctx, db } = setup();
    autoOn.mockResolvedValue(true);
    verify.mockResolvedValue({
      result: { ok: false, reason: "not_receipt", detail: "на фото кот" },
    });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({
      ok: true,
      result: "retry",
      paymentFailed: false,
    });
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
    expect(notifyNew).not.toHaveBeenCalled();
  });

  it("сумма не сошлась — продавцу с причиной, без выдачи", async () => {
    const { ctx } = setup();
    autoOn.mockResolvedValue(true);
    verify.mockResolvedValue({
      result: { ok: false, reason: "amount_mismatch", detail: "в чеке 2000" },
    });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "review" });
    expect(notifyNew.mock.calls[0]![4]).toEqual({ reviewReason: "в чеке 2000" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("выдача не прошла — продавцу о сбое, покупателю «на проверке»", async () => {
    const { ctx } = setup();
    autoOn.mockResolvedValue(true);
    verify.mockResolvedValue({ result: { ok: true, matchedAmount: 2500 } });
    deliver.mockResolvedValue({ sent: 0, failed: 1, pending: 0 });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: true, result: "review" });
    expect(notifyFail).toHaveBeenCalledTimes(1);
  });

  it("чек уже был у другого заказа — отказ без проверки", async () => {
    const { ctx } = setup();
    attach.mockResolvedValue({ ok: false, reason: "duplicate" });
    expect(await receiveWebProof(ctx, 9, file)).toEqual({ ok: false, reason: "duplicate" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("скидки покрыли весь заказ — выдаём сразу; обычный заказ ждёт чека молча", async () => {
    const { ctx } = setup();
    await afterWebOrderPlaced(ctx, ORDER as never, false);
    expect(deliver).not.toHaveBeenCalled();
    expect(notifyNew).not.toHaveBeenCalled();
    await afterWebOrderPlaced(ctx, ORDER as never, true);
    expect(deliver).toHaveBeenCalledWith(ctx, 9);
    expect(notifyNew).toHaveBeenCalledTimes(1);
  });

  it("физический с оплатой при получении — ждёт подтверждения продавца, продавцу о заказе", async () => {
    const { ctx, db } = setup();
    db.tables.orders![0]!.status = "awaiting_payment";
    db.tables.orders![0]!.fulfillment_kind = "physical";
    await afterWebOrderPlaced(
      ctx,
      { ...ORDER, status: "awaiting_payment", fulfillment_kind: "physical" } as never,
      false,
      0,
    );
    expect(db.tables.orders![0]!.status).toBe("awaiting_confirmation");
    expect(notifyNew).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("физический с задатком — ждёт оплаты молча", async () => {
    const { ctx, db } = setup();
    db.tables.orders![0]!.status = "awaiting_payment";
    await afterWebOrderPlaced(
      ctx,
      { ...ORDER, status: "awaiting_payment", fulfillment_kind: "physical" } as never,
      false,
      750,
    );
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
    expect(notifyNew).not.toHaveBeenCalled();
  });
});
