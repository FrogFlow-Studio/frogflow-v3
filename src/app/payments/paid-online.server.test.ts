import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Оплата картой подтверждена: выдача в канале заказа. */
let order: Record<string, unknown> = {};
const runOrderAction = vi.fn();
const onOrderPaid = vi.fn();
const notifyNew = vi.fn();
const notifyFail = vi.fn();

vi.mock("@/core/orders/orders", () => ({ getOrder: async () => order }));
vi.mock("@/app/admin/admin.server", () => ({ runOrderAction }));
vi.mock("@/channels/telegram/handle-update", () => ({ onOrderPaid }));
vi.mock("@/channels/telegram/api", () => ({ telegramApi: () => ({}) }));
vi.mock("@/config/env", () => ({ env: () => ({}) }));
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({}),
  notifyDeliveryFailure: notifyFail,
}));
vi.mock("@/channels/telegram/admin-notify", () => ({ notifyAdminNewOrder: notifyNew }));

const { afterPaidOnline } = await import("./paid-online.server");
const ctx = {
  tenant: { id: "b" },
  secrets: { telegramToken: () => "x" },
} as unknown as TenantContext;

beforeEach(() => {
  for (const f of [runOrderAction, onOrderPaid, notifyNew, notifyFail]) f.mockReset();
  runOrderAction.mockResolvedValue({ ok: true, message: "" });
});

describe("после оплаты картой", () => {
  it("Telegram — прежний путь бота", async () => {
    order = { id: 1, platform: "telegram", fulfillment_kind: "digital" };
    await afterPaidOnline(ctx, 1);
    expect(onOrderPaid).toHaveBeenCalledTimes(1);
    expect(runOrderAction).not.toHaveBeenCalled();
  });

  it.each(["web", "instagram", "whatsapp"])(
    "%s — выдаём тем же «подтвердить и выдать», продавцу «оплачен онлайн»",
    async (platform) => {
      order = { id: 2, platform, fulfillment_kind: "digital" };
      await afterPaidOnline(ctx, 2);
      expect(runOrderAction).toHaveBeenCalledWith(ctx, 2, "confirm", "robokassa");
      expect(notifyNew.mock.calls[0]![4]).toEqual({ paidOnline: true });
      expect(notifyFail).not.toHaveBeenCalled();
    },
  );

  it("выдача не прошла — продавцу о сбое выдачи с этим заказом, уведомление о новом заказе всё равно уходит", async () => {
    order = { id: 3, platform: "instagram", fulfillment_kind: "digital" };
    runOrderAction.mockResolvedValue({ ok: false, message: "нет диалога" });
    await afterPaidOnline(ctx, 3);
    expect(notifyFail).toHaveBeenCalledTimes(1);
    expect(notifyFail).toHaveBeenCalledWith(ctx, order, { sent: 0, failed: 1 });
    expect(notifyNew).toHaveBeenCalledTimes(1);
  });

  it("физический заказ — не выдаём, только сообщаем продавцу", async () => {
    order = { id: 4, platform: "web", fulfillment_kind: "physical" };
    await afterPaidOnline(ctx, 4);
    expect(runOrderAction).not.toHaveBeenCalled();
    expect(notifyNew).toHaveBeenCalledTimes(1);
  });
});
