import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "@/core/orders/orders";

const sendOrEnqueue = vi.fn(async (..._args: unknown[]) => true);
const zernioTargetForOrder = vi.fn(async (_ctx: unknown, order: { platform: string }) => ({
  platform: order.platform,
  conversationId: `conv-${order.platform}`,
  accountId: "acc-1",
}));

vi.mock("@/core/outbox/outbox", () => ({ sendOrEnqueue }));
vi.mock("@/channels/zernio/outbound.server", () => ({ zernioTargetForOrder }));
vi.mock("@/channels/zernio/outbox.server", () => ({ zernioOutboxSender: () => "zernio-sender" }));
vi.mock("@/channels/telegram/outbox", () => ({ telegramOutboxSender: "telegram-sender" }));

const { notifyCustomer } = await import("./admin.server");

const ctx = { tenant: { id: "t-notify", telegramTokenEnc: "enc" } } as unknown as TenantContext;
const order = (platform: string) =>
  ({ id: "o1", platform, telegram_id: 42, user_key: `${platform}:1` }) as unknown as OrderWithItems;

/** Цель, куда ушло уведомление: канал и адрес. */
function lastTarget() {
  const [, msg, sender] = sendOrEnqueue.mock.calls.at(-1)!;
  return { target: (msg as { target: Record<string, unknown> }).target, sender };
}

beforeEach(() => {
  sendOrEnqueue.mockClear();
  zernioTargetForOrder.mockClear();
});

describe("notifyCustomer: заказ уведомляется в своём канале", () => {
  it("заказы из Instagram и WhatsApp уходят в свой диалог через Zernio, а не в Telegram", async () => {
    for (const platform of ["instagram", "whatsapp"]) {
      expect(await notifyCustomer(ctx, order(platform), "готово")).toBe(true);
      expect(lastTarget()).toEqual({
        target: {
          channel: "zernio",
          platform,
          conversationId: `conv-${platform}`,
          accountId: "acc-1",
        },
        sender: "zernio-sender",
      });
    }
  });

  it("заказ из Telegram уходит в чат Telegram по telegram_id", async () => {
    expect(await notifyCustomer(ctx, order("telegram"), "готово")).toBe(true);
    expect(zernioTargetForOrder).not.toHaveBeenCalled();
    expect(lastTarget()).toEqual({
      target: { channel: "telegram", chatId: "42" },
      sender: "telegram-sender",
    });
  });
});

describe("notifyCustomer: старые заказы с необычной платформой, как в v1", () => {
  it("пустая или незнакомая платформа — это Telegram, а не Instagram/WhatsApp", async () => {
    for (const platform of ["", "Telegram", "tg", "bot"]) {
      expect(await notifyCustomer(ctx, order(platform), "готово")).toBe(true);
      expect(lastTarget()).toEqual({
        target: { channel: "telegram", chatId: "42" },
        sender: "telegram-sender",
      });
    }
    expect(zernioTargetForOrder).not.toHaveBeenCalled();
  });

  it("заказ, заведённый продавцом вручную, никуда не уведомляется: чата нет", async () => {
    expect(await notifyCustomer(ctx, order("manual"), "готово")).toBe(false);
    expect(sendOrEnqueue).not.toHaveBeenCalled();
    expect(zernioTargetForOrder).not.toHaveBeenCalled();
  });
});
