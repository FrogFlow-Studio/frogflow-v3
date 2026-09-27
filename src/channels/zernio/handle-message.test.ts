import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";

const customer = {
  userKey: "wa:77001112233",
  platform: "whatsapp",
  telegramId: -7,
  firstName: "Аня",
  state: { consultant: { last_reply_at: new Date(Date.now() - 3600_000).toISOString() } },
} as unknown as Customer;

vi.mock("@/core/customers/customers", () => ({
  upsertCustomer: vi.fn(async () => customer),
  isBlocked: vi.fn(async () => false),
}));
vi.mock("@/core/instagram/direct-bot-settings", () => ({
  loadDirectBotSettings: vi.fn(async () => ({ enabled: true, ignoreExcluded: false })),
}));
const pauseConsultant = vi.fn(async () => {});
const runConsultant = vi.fn(async () => ({ reply: "Здравствуйте!" }));
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  isPaused: () => false,
  pauseConsultant,
  runConsultant,
}));

const { handleZernioMessage } = await import("./handle-message");

const ctx = {
  tenant: { id: "b", vertical: "digital", modules: { whatsapp: true }, settings: {} },
} as unknown as TenantContext;

describe("консультант и менеджер из приложения", () => {
  it("менеджер ответил из приложения — консультант молчит, ставит паузу и пишет это итогом события", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const transport = {
      send,
      tail: async () => [
        {
          direction: "incoming",
          message: "есть в наличии?",
          createdAt: new Date(Date.now() - 120_000).toISOString(),
        },
        {
          direction: "outgoing",
          message: "Да, есть, сейчас пришлю фото",
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    } as unknown as ZernioTransport;
    const r = await handleZernioMessage(
      ctx,
      {
        account: { platform: "whatsapp", accountId: "acc-1" } as never,
        conversation: { id: "conv-1" } as never,
        message: { text: "а размер?", sender: { id: "77001112233" } } as never,
      } as never,
      transport,
    );
    // Итог события уходит в zernio_logs (dispatch): видно, что проверка увидела менеджера.
    expect(r).toEqual({
      status: "processed",
      note: "менеджер отвечает из приложения — консультант на паузе 12 ч",
    });
    expect(pauseConsultant).toHaveBeenCalledOnce();
    expect(runConsultant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
