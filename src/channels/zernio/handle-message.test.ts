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

const setOptOut = vi.fn(async () => true);
vi.mock("@/core/customers/opt-out", async (orig) => ({
  ...(await orig<typeof import("@/core/customers/opt-out")>()),
  setOptOut,
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
      note: "менеджер отвечает из приложения — консультант на паузе",
    });
    expect(pauseConsultant).toHaveBeenCalledOnce();
    expect(runConsultant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("«стоп» в WhatsApp", () => {
  const payload = (text: string) =>
    ({
      account: { platform: "whatsapp", accountId: "acc-1" } as never,
      conversation: { id: "conv-1" } as never,
      message: { text, sender: { id: "77001112233" } } as never,
    }) as never;
  const transport = () =>
    ({
      send: vi.fn(async () => ({ ok: true })),
      tail: async () => [],
    }) as unknown as ZernioTransport;

  it("вне оформления — отписка с подтверждением, консультант молчит", async () => {
    runConsultant.mockClear();
    setOptOut.mockClear();
    const t = transport();
    const r = await handleZernioMessage(ctx, payload("Стоп"), t);
    expect(r).toEqual({ status: "processed", note: "отписка от рассылок" });
    expect(setOptOut).toHaveBeenCalledWith(ctx, customer.userKey, true);
    expect(t.send).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      expect.stringContaining("Вернуться — напишите «подписаться»"),
      { platform: "whatsapp" },
    );
    expect(runConsultant).not.toHaveBeenCalled();
  });

  it("«подписаться» возвращает", async () => {
    setOptOut.mockClear();
    const r = await handleZernioMessage(ctx, payload("подписаться"), transport());
    expect(r.note).toBe("возврат к рассылкам");
    expect(setOptOut).toHaveBeenCalledWith(ctx, customer.userKey, false);
  });

  it("на шаге оформления «стоп» не отписывает", async () => {
    setOptOut.mockClear();
    const inFlow = { ...customer, state: { ...customer.state, mode: "awaiting_contact" } };
    const { upsertCustomer } = await import("@/core/customers/customers");
    vi.mocked(upsertCustomer).mockResolvedValueOnce(inFlow as Customer);
    const r = await handleZernioMessage(ctx, payload("стоп"), transport());
    expect(r.note).not.toBe("отписка от рассылок");
    expect(setOptOut).not.toHaveBeenCalled();
  });
});
