import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Ответ продавца из «Чата», когда окно 24 часа закрыто (WhatsApp 131047, Instagram 10/2018278). */
type Customer = Record<string, unknown>;
let customer: Customer;
let template: string | null = null;
let started: Record<string, unknown>[] = [];
let startResult: { ok: boolean; error?: string } = { ok: true };
const logged: string[] = [];

vi.mock("@/config/env", () => ({
  env: () => ({ TELEGRAM_API_BASE: "https://tg", SESSION_SECRET: "s".repeat(40) }),
}));
vi.mock("@/core/customers/customers", () => ({ getCustomerByTelegramId: async () => customer }));
vi.mock("@/core/settings/settings", () => ({ getSetting: async () => template }));
vi.mock("@/core/orders/orders", () => ({
  listCustomerOrders: async () => [{ id: 9, platform: "instagram" }],
}));
vi.mock("@/channels/zernio/api.server", () => ({
  sendInboxMessage: async (_c: string, _a: string, _m: string, opts: { platform: string }) => ({
    ok: false,
    error: "window",
    failure:
      opts.platform === "whatsapp"
        ? { status: 400, platformCode: 131047 }
        : { status: 400, platformCode: 10, platformSubcode: 2018278 },
  }),
  startWhatsAppConversation: async (p: Record<string, unknown>) => {
    started.push(p);
    return startResult;
  },
  describeSendError: () => "шаблон не одобрен",
}));
vi.mock("@/core/chat/chat", () => ({
  recordMessage: async (_ctx: unknown, m: { text: string }) => {
    logged.push(m.text);
  },
}));

const { replyAsManager } = await import("./admin.server");
const ctx = {
  tenant: {
    id: "11111111-1111-1111-1111-111111111111",
    archived: false,
    modules: { shop: true },
    settings: { slug: "shop", served_by: "v2" },
  },
  appUrl: "https://app.test",
} as unknown as TenantContext;

const zc = (platform: string, extra: Customer = {}) => ({
  platform,
  zernioConversationId: "conv",
  zernioAccountId: "acc",
  contactPhone: "+77001112233",
  ...extra,
});

beforeEach(() => {
  template = null;
  started = [];
  startResult = { ok: true };
  logged.length = 0;
});

describe("ответ из «Чата» вне окна 24 часа", () => {
  it("WhatsApp с шаблоном: текст уходит параметром одной строкой, в журнале — ответ", async () => {
    customer = zc("whatsapp");
    template = "manager_reply:ru";
    await replyAsManager(ctx, 42, "Здравствуйте!\n\nЗаказ готов.\tЗаберите", undefined, "d1");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      accountId: "acc",
      phone: "+77001112233",
      templateName: "manager_reply",
      templateLanguage: "ru",
      templateParams: ["Здравствуйте! · Заказ готов. Заберите"],
      idempotencyScope: "chat-template:d1",
    });
    expect(logged).toEqual(["Здравствуйте!\n\nЗаказ готов.\tЗаберите"]);
  });

  it("WhatsApp без шаблона — понятная фраза, где его задать; ничего не записано", async () => {
    customer = zc("whatsapp");
    await expect(replyAsManager(ctx, 42, "Привет")).rejects.toMatchObject({
      key: "err.admin.waWindowNoTemplate",
    });
    expect(started).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("WhatsApp: шаблон не принят — причина продавцу", async () => {
    customer = zc("whatsapp");
    template = "manager_reply:ru";
    startResult = { ok: false, error: "x" };
    await expect(replyAsManager(ctx, 42, "Привет")).rejects.toMatchObject({
      key: "err.admin.channelRefused",
      vars: { reason: "шаблон не одобрен" },
    });
    expect(logged).toEqual([]);
  });

  it("WhatsApp без номера — шаблон отправить некуда", async () => {
    customer = zc("whatsapp", { contactPhone: null });
    template = "manager_reply:ru";
    await expect(replyAsManager(ctx, 42, "Привет")).rejects.toMatchObject({
      key: "err.admin.waNoPhone",
    });
  });

  it("Instagram: писать первым нельзя — фраза и ссылка на страницу последнего заказа", async () => {
    customer = zc("instagram");
    const err = (await replyAsManager(ctx, 42, "Привет").catch((e: unknown) => e)) as {
      key: string;
      vars: { url: string };
    };
    expect(err.key).toBe("err.admin.igWindowLink");
    expect(err.vars.url).toMatch(/^https:\/\/app\.test\/s\/shop\/order\/9\?t=[0-9a-f]{32}$/);
    expect(started).toEqual([]);
  });
});
