import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

const sent: string[] = [];
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => null,
  notifyAdminsHtml: vi.fn(async (_ctx: unknown, text: string) => {
    sent.push(text);
  }),
}));
vi.mock("@/app/admin/locale.server", () => ({
  adminTFor:
    async () =>
    (key: string, p: Record<string, unknown> = {}) =>
      `${key}|${Object.entries(p)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}`,
}));
vi.mock("@/channels/zernio/outbound.server", () => ({
  sendToZernioTarget: vi.fn(),
  zernioTargetForOrder: vi.fn(),
}));
vi.mock("@/core/preorder/reschedule", async (orig) => {
  const real = await orig<typeof import("@/core/preorder/reschedule")>();
  const o = (id: number) => ({
    id,
    displayNo: 100 + id,
    platform: "telegram",
    telegramId: id,
    userKey: null,
  });
  return {
    ...real,
    notifyPreorderMoved: vi.fn(async () => ({
      notified: 1,
      missed: [o(1)],
      left: 2,
      leftOrders: [o(2), o(3)],
    })),
  };
});
const { notifyPreorderMovedChannels } = await import("./notify.server");

describe("перенос предзаказа: сообщение продавцу", () => {
  it("называет номера и тех, кому не успели написать, а не только их число", async () => {
    const ctx = {
      tenant: { id: "b", modules: {}, settings: {} },
    } as unknown as TenantContext;
    await notifyPreorderMovedChannels(ctx, {
      productId: "p",
      name: "Торт",
      from: "2026-10-20",
      to: "2026-11-05",
    });
    const text = sent.join("\n");
    expect(text).toContain("#101");
    expect(text).toContain("preorder.moved.left|name=Торт");
    expect(text).toContain("#102, #103");
  });
});
